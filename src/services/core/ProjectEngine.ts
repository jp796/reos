/**
 * ProjectEngine — the transaction↔project state machine (Stage-3 build).
 *
 * Flow (flip / wholetail / rental_brrrr):
 *   acquisition transaction CLOSED
 *     → convertToProject: create a Project from projectTemplates, instantiate
 *       its phase tasks with due dates anchored to the acquisition close date
 *       and BOUNDED to the holding window (out-of-window dates are flagged).
 *     → as project tasks complete, onProjectTaskCompleted auto-generates the
 *       terminal "List it" task once everything else is done.
 *     → completing "List it" → completeProjectAndCreateDisposition: mark the
 *       Project complete and spin a NEW disposition Transaction on the same
 *       Asset (assetRole=disposition) running its own pipeline that tracks
 *       investment return + realtor commission separately.
 *
 * Every state change is NON-DESTRUCTIVE and reversible (revertToTransaction /
 * reclassifyStrategy never delete tasks, docs, economics, or history) and is
 * audit-logged. Wholesale / double-close have no project phase (they overlap
 * the single transaction) — convertToProject is a no-op for them.
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Strategy } from "./DealClassifierService";
import { hasProjectPhase, projectReturnsToMarketAs } from "./dealLabels";
import { getProjectTemplate, projectTasks, type ProjectTemplate } from "./projectTemplates";

type Db = PrismaClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Anchor a task's due date and keep it inside the window. We do NOT silently
 * clamp an overflowing date — we keep it and FLAG it so the TC sees the
 * timeline can't fit and can compress or extend (JP's decision 3).
 */
export function boundDueDate(
  windowStart: Date,
  dueOffsetDays: number,
  windowEnd: Date,
): { dueAt: Date; outOfWindow: boolean } {
  const dueAt = new Date(windowStart.getTime() + dueOffsetDays * DAY_MS);
  const before = dueAt.getTime() < windowStart.getTime();
  const after = dueAt.getTime() > windowEnd.getTime();
  return { dueAt, outOfWindow: before || after };
}

async function audit(
  db: Db,
  opts: {
    accountId: string;
    transactionId?: string | null;
    assetId: string;
    ruleName: string;
    before?: unknown;
    after?: unknown;
    actorUserId?: string | null;
  },
): Promise<void> {
  try {
    await db.automationAuditLog.create({
      data: {
        accountId: opts.accountId,
        transactionId: opts.transactionId ?? null,
        entityType: "asset",
        entityId: opts.assetId,
        ruleName: opts.ruleName,
        actionType: "update",
        sourceType: "manual",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: (opts.before ?? {}) as Prisma.InputJsonValue,
        afterJson: (opts.after ?? {}) as Prisma.InputJsonValue,
        actorUserId: opts.actorUserId ?? null,
      },
    });
  } catch {
    /* audit is best-effort — never block a transition on it */
  }
}

/** The Asset's acquisition transaction — the oldest one (its close triggers
 *  the project). Stage/project tasks hang off it so they surface in the
 *  existing TaskPanel. */
async function acquisitionTxn(db: Db, assetId: string) {
  return db.transaction.findFirst({
    where: { assetId },
    orderBy: { createdAt: "asc" },
    select: { id: true, accountId: true, contactId: true, closingDate: true, propertyAddress: true, city: true, state: true, zip: true, side: true },
  });
}

export interface ConvertResult {
  ok: boolean;
  reason?: string;
  projectId?: string;
  created?: number;
  flaggedOutOfWindow?: number;
}

/**
 * Create the Project + timeline for an asset whose acquisition just closed.
 * Idempotent: if an active project already exists, returns it. No-op for
 * strategies without a project phase.
 */
export async function convertToProject(
  db: Db,
  opts: { assetId: string; actorUserId?: string | null; startDate?: Date },
): Promise<ConvertResult> {
  const asset = await db.asset.findUnique({
    where: { id: opts.assetId },
    select: { id: true, accountId: true, strategy: true, currentStageName: true },
  });
  if (!asset) return { ok: false, reason: "asset_not_found" };
  const strategy = asset.strategy as Strategy;
  if (!hasProjectPhase(strategy)) return { ok: false, reason: "strategy_has_no_project_phase" };

  const tpl = getProjectTemplate(strategy);
  if (!tpl) return { ok: false, reason: "no_template" };

  const existing = await db.project.findFirst({
    where: { assetId: asset.id, status: "active" },
    select: { id: true },
  });
  if (existing) return { ok: true, projectId: existing.id, created: 0, flaggedOutOfWindow: 0 };

  const txn = await acquisitionTxn(db, asset.id);
  if (!txn) return { ok: false, reason: "no_transaction" };

  const start = opts.startDate ?? txn.closingDate ?? new Date();
  const targetCompletionAt = new Date(start.getTime() + tpl.totalDays * DAY_MS);

  const project = await db.project.create({
    data: {
      assetId: asset.id,
      accountId: asset.accountId,
      type: tpl.projectType,
      status: "active",
      projectTemplateKey: tpl.key,
      startedAt: start,
      targetCompletionAt,
      sourceTransactionId: txn.id,
    },
    select: { id: true },
  });

  // FLAG 4: a rehab project draws against funded capital. Link a DrawSchedule
  // to the Project and record WHERE the money comes from (the primary capital-
  // stack entry). Wholetail make-ready has no rehab draws, so it's skipped.
  const isRehab = tpl.projectType === "rehab" || tpl.projectType === "renovation_rent_ready";
  if (isRehab) {
    const primaryFunding = await db.capitalStackEntry.findFirst({
      where: { assetId: asset.id },
      orderBy: { principal: "desc" },
      select: { id: true, type: true, lenderContactId: true, principal: true, rate: true },
    });
    await db.project.update({
      where: { id: project.id },
      data: {
        fundingSourceJson: (primaryFunding
          ? {
              type: primaryFunding.type,
              lenderContactId: primaryFunding.lenderContactId,
              amount: primaryFunding.principal,
              rate: primaryFunding.rate,
              capitalStackEntryId: primaryFunding.id,
            }
          : { type: "unspecified", lenderContactId: null, amount: null, rate: null }) as Prisma.InputJsonValue,
      },
    });
    // Reuse an existing active schedule (e.g. draws already started) by
    // linking it to the project; only create one if none exists — so we never
    // leave two active schedules on the asset.
    const existingSchedule = await db.drawSchedule.findFirst({
      where: { assetId: asset.id, status: "active" },
      select: { id: true },
    });
    if (existingSchedule) {
      await db.drawSchedule.update({
        where: { id: existingSchedule.id },
        data: { projectId: project.id },
      });
    } else {
      await db.drawSchedule.create({
        data: {
          assetId: asset.id,
          accountId: asset.accountId,
          projectId: project.id,
          totalBudget: primaryFunding?.principal ?? null,
        },
      });
    }
  }

  let created = 0;
  let flagged = 0;
  for (const t of projectTasks(tpl)) {
    const { dueAt, outOfWindow } = boundDueDate(start, t.dueOffsetDays, targetCompletionAt);
    if (outOfWindow) flagged++;
    await db.task.create({
      data: {
        transactionId: txn.id,
        assetId: asset.id,
        projectId: project.id,
        stageKey: t.phaseKey,
        templateKey: t.key,
        title: t.name,
        description: `${t.phaseName} · owner: ${t.ownerRole}` + (outOfWindow ? " · ⚠ due date falls outside the holding window — compress or extend" : ""),
        dueAt,
        priority: outOfWindow ? "high" : "normal",
        dueDateOutOfWindow: outOfWindow,
      },
    });
    created++;
  }

  await db.asset.update({
    where: { id: asset.id },
    data: { currentStageName: tpl.phases[0]?.key ?? null },
  });

  await audit(db, {
    accountId: asset.accountId,
    transactionId: txn.id,
    assetId: asset.id,
    ruleName: "convert_transaction_to_project",
    after: { projectId: project.id, template: tpl.key, created, flaggedOutOfWindow: flagged, targetCompletionAt },
    actorUserId: opts.actorUserId,
  });

  return { ok: true, projectId: project.id, created, flaggedOutOfWindow: flagged };
}

/** True when every non-"List it" task in the project is complete. */
async function allProjectWorkDone(db: Db, projectId: string): Promise<boolean> {
  const open = await db.task.count({
    where: { projectId, isListItTask: false, completedAt: null },
  });
  return open === 0;
}

/**
 * Hook the task-complete path: after a project task is marked complete,
 *   - if it was the terminal "List it" task → complete the project + spin the
 *     disposition transaction;
 *   - else, once ALL other project tasks are done, auto-generate the "List it"
 *     task (decision 1). Idempotent.
 */
export async function onProjectTaskCompleted(
  db: Db,
  opts: { taskId: string; actorUserId?: string | null },
): Promise<{ listItCreated?: string; dispositionTransactionId?: string } | null> {
  const task = await db.task.findUnique({
    where: { id: opts.taskId },
    select: { id: true, projectId: true, isListItTask: true, completedAt: true },
  });
  if (!task?.projectId || !task.completedAt) return null;

  if (task.isListItTask) {
    const r = await completeProjectAndCreateDisposition(db, {
      projectId: task.projectId,
      actorUserId: opts.actorUserId,
    });
    return r.ok ? { dispositionTransactionId: r.dispositionTransactionId } : null;
  }

  if (!(await allProjectWorkDone(db, task.projectId))) return null;

  // Every other task done → generate the terminal "List it" task once.
  const project = await db.project.findUnique({
    where: { id: task.projectId },
    select: { id: true, assetId: true, accountId: true, projectTemplateKey: true, sourceTransactionId: true, targetCompletionAt: true, status: true },
  });
  if (!project || project.status !== "active") return null;
  const existingListIt = await db.task.findFirst({
    where: { projectId: project.id, isListItTask: true },
    select: { id: true },
  });
  if (existingListIt) return null;

  const asset = await db.asset.findUnique({ where: { id: project.assetId }, select: { strategy: true } });
  const tpl = asset ? getProjectTemplate(asset.strategy as Strategy) : null;
  const txnId = project.sourceTransactionId ?? (await acquisitionTxn(db, project.assetId))?.id;
  if (!txnId || !tpl) return null;

  const listIt = await db.task.create({
    data: {
      transactionId: txnId,
      assetId: project.assetId,
      projectId: project.id,
      stageKey: "list_it",
      templateKey: "list_it",
      title: tpl.listItTaskName,
      description: "All project work is complete. Completing this task starts the disposition transaction.",
      isListItTask: true,
      dueAt: project.targetCompletionAt ?? new Date(),
      priority: "high",
    },
    select: { id: true },
  });
  return { listItCreated: listIt.id };
}

export interface DispositionResult {
  ok: boolean;
  reason?: string;
  dispositionTransactionId?: string;
  /** True for rentals: no sale, so the asset moved to Under-Management hold
   *  instead of getting a disposition transaction (FLAG 3). */
  heldUnderManagement?: boolean;
}

/** Recurring hold stage a completed rental project drops into (matches
 *  strategyTemplates RENTAL_BRRRR "under_management"). */
const RENTAL_HOLD_STAGE = "under_management";

/**
 * Back-end (disposition-transaction) checklist for a resale — the listing →
 * under-contract → sold work that used to be flat-template stages. Seeded onto
 * the disposition transaction so it lives on the RIGHT transaction (FLAG 1).
 */
const DISPOSITION_TASKS: { key: string; name: string; ownerRole: string }[] = [
  { key: "list_property", name: "List property on MLS + syndicate", ownerRole: "agent" },
  { key: "showings", name: "Open house + schedule showings", ownerRole: "agent" },
  { key: "price_review", name: "Re-evaluate for price drop", ownerRole: "agent" },
  { key: "under_contract", name: "Buyer under contract — handle repair requests", ownerRole: "agent" },
  { key: "remove_staging", name: "Remove soft staging after appraisal", ownerRole: "agent" },
  { key: "approve_settlement", name: "Approve settlement statement", ownerRole: "agent" },
  { key: "close_reconcile", name: "Close / sold — pay off lender + profit reconciliation", ownerRole: "agent" },
];

/**
 * Complete the project. For a RESALE (flip / wholetail) create the disposition
 * transaction on the same Asset (its own pipeline + dual-income ledger) and
 * seed the back-end checklist. For a RENTAL (lease) there is NO sale — mark the
 * project complete and move the asset to the recurring Under-Management hold
 * (FLAG 3). Idempotent.
 */
export async function completeProjectAndCreateDisposition(
  db: Db,
  opts: { projectId: string; actorUserId?: string | null },
): Promise<DispositionResult> {
  const project = await db.project.findUnique({
    where: { id: opts.projectId },
    select: { id: true, assetId: true, accountId: true, status: true, dispositionTransactionId: true },
  });
  if (!project) return { ok: false, reason: "project_not_found" };
  if (project.dispositionTransactionId) {
    return { ok: true, dispositionTransactionId: project.dispositionTransactionId };
  }
  if (project.status === "complete") {
    return { ok: true, heldUnderManagement: true };
  }

  const asset = await db.asset.findUnique({ where: { id: project.assetId }, select: { strategy: true } });
  const strategy = (asset?.strategy ?? "flip") as Strategy;
  const kind = projectReturnsToMarketAs(strategy) ?? "sale";

  // ── RENTAL: hold, don't sell. No disposition transaction (FLAG 3). ──
  if (kind === "lease") {
    await db.project.update({
      where: { id: project.id },
      data: { status: "complete", completedAt: new Date() },
    });
    await db.asset.update({
      where: { id: project.assetId },
      data: { currentStageName: RENTAL_HOLD_STAGE },
    });
    await audit(db, {
      accountId: project.accountId,
      assetId: project.assetId,
      ruleName: "project_complete_hold_under_management",
      after: { projectId: project.id, movedTo: RENTAL_HOLD_STAGE },
      actorUserId: opts.actorUserId,
    });
    return { ok: true, heldUnderManagement: true };
  }

  // ── FLIP / WHOLETAIL: create the disposition (resale) transaction. ──
  const src = await acquisitionTxn(db, project.assetId);
  if (!src) return { ok: false, reason: "no_source_transaction" };

  const disposition = await db.transaction.create({
    data: {
      accountId: project.accountId,
      contactId: src.contactId,
      assetId: project.assetId,
      propertyAddress: src.propertyAddress,
      city: src.city,
      state: src.state,
      zip: src.zip,
      status: "listing",
      side: "sell",
      transactionType: "seller",
      assetRole: "disposition",
      pipelineName: "Disposition",
      stageName: "Prep to list",
      // Dual-income ledger seeded empty — filled from JP's underwriting sheet.
      dispositionIncomeJson: { kind, investmentReturn: null, realtorCommission: null },
    },
    select: { id: true },
  });

  // Seed the back-end checklist ON the disposition transaction (FLAG 1).
  for (const t of DISPOSITION_TASKS) {
    await db.task.create({
      data: {
        transactionId: disposition.id,
        assetId: project.assetId,
        stageKey: "disposition",
        templateKey: t.key,
        title: t.name,
        description: `Disposition · owner: ${t.ownerRole}`,
      },
    });
  }

  await db.project.update({
    where: { id: project.id },
    data: { status: "complete", completedAt: new Date(), dispositionTransactionId: disposition.id },
  });

  await audit(db, {
    accountId: project.accountId,
    transactionId: disposition.id,
    assetId: project.assetId,
    ruleName: "project_complete_create_disposition",
    after: { projectId: project.id, dispositionTransactionId: disposition.id, kind },
    actorUserId: opts.actorUserId,
  });

  return { ok: true, dispositionTransactionId: disposition.id };
}

/**
 * Reverse a project conversion NON-DESTRUCTIVELY: archive the active project
 * (keeps every task, doc, economics record, and audit entry) and clear the
 * Asset's project-stage pointer so the deal reads as a transaction again.
 * Fully reversible — re-running convertToProject makes a fresh project.
 */
export async function revertToTransaction(
  db: Db,
  opts: { assetId: string; actorUserId?: string | null },
): Promise<{ ok: boolean; archivedProjectId?: string; reason?: string }> {
  const asset = await db.asset.findUnique({ where: { id: opts.assetId }, select: { id: true, accountId: true, currentStageName: true } });
  if (!asset) return { ok: false, reason: "asset_not_found" };
  const project = await db.project.findFirst({
    where: { assetId: asset.id, status: "active" },
    select: { id: true },
  });
  if (!project) return { ok: false, reason: "no_active_project" };

  await db.project.update({ where: { id: project.id }, data: { status: "archived" } });
  await db.asset.update({ where: { id: asset.id }, data: { currentStageName: null } });

  await audit(db, {
    accountId: asset.accountId,
    assetId: asset.id,
    ruleName: "revert_project_to_transaction",
    before: { currentStageName: asset.currentStageName },
    after: { archivedProjectId: project.id },
    actorUserId: opts.actorUserId,
  });
  return { ok: true, archivedProjectId: project.id };
}

/**
 * Change an Asset's strategy NON-DESTRUCTIVELY (decision 5): update the
 * classification only — every existing task, document, economics record, and
 * project is preserved. Does NOT delete stage tasks (unlike the legacy
 * classification-override PATCH). Audit-logged and reversible by reclassifying
 * back.
 */
export async function reclassifyStrategy(
  db: Db,
  opts: { assetId: string; newStrategy: Strategy; newTitlePath?: string | null; actorUserId?: string | null },
): Promise<{ ok: boolean; reason?: string; from?: string; to?: string }> {
  const asset = await db.asset.findUnique({
    where: { id: opts.assetId },
    select: { id: true, accountId: true, strategy: true, titlePath: true },
  });
  if (!asset) return { ok: false, reason: "asset_not_found" };

  await db.asset.update({
    where: { id: asset.id },
    data: {
      strategy: opts.newStrategy,
      ...(opts.newTitlePath !== undefined ? { titlePath: opts.newTitlePath } : {}),
    },
  });

  await audit(db, {
    accountId: asset.accountId,
    assetId: asset.id,
    ruleName: "reclassify_strategy_nondestructive",
    before: { strategy: asset.strategy, titlePath: asset.titlePath },
    after: { strategy: opts.newStrategy, titlePath: opts.newTitlePath ?? asset.titlePath },
    actorUserId: opts.actorUserId,
  });
  return { ok: true, from: asset.strategy, to: opts.newStrategy };
}
