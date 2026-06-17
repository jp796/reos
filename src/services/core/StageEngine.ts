/**
 * StageEngine — instantiate strategy-stage tasks onto an Asset and
 * advance through the lifecycle (spec §6, §8).
 *
 * The pure template lives in strategyTemplates.ts; this maps it onto DB
 * rows. Stage tasks are Task rows carrying assetId + stageKey +
 * templateKey, so they group by stage and dedupe on re-instantiation.
 * They also carry the Asset's primary transactionId (Task.transactionId
 * is required) so they surface in the existing per-transaction TaskPanel
 * with zero new UI.
 *
 * `auto` template tasks (Drive scaffold, CRM update, archive) are NOT
 * queued as human Tasks here — they're system actions wired to their own
 * automations in later phases. Only human tasks become rows.
 *
 * Auto-advance (spec §8.1): completing a stage advances the Asset and
 * instantiates the next stage's tasks. This module exposes the
 * primitives; the task-complete path / a manual control calls
 * advanceStage when a stage is done.
 */

import type { PrismaClient } from "@prisma/client";
import type { Strategy } from "./DealClassifierService";
import {
  firstStage,
  nextStage,
  stageByKey,
  humanTasks,
  hasStageLifecycle,
  isRecurringStage,
  type StageTemplate,
} from "./strategyTemplates";

type Db = PrismaClient;

async function instantiateStage(
  db: Db,
  opts: { assetId: string; transactionId: string; stage: StageTemplate },
): Promise<number> {
  const { assetId, transactionId, stage } = opts;
  let created = 0;
  for (const t of humanTasks(stage)) {
    // Dedupe — re-applying a stage must not double up its tasks.
    const exists = await db.task.findFirst({
      where: { assetId, stageKey: stage.key, templateKey: t.key },
      select: { id: true },
    });
    if (exists) continue;
    await db.task.create({
      data: {
        transactionId,
        assetId,
        stageKey: stage.key,
        templateKey: t.key,
        title: t.name,
        description: `${stage.name} · owner: ${t.ownerRole}`,
      },
    });
    created++;
  }
  return created;
}

/** Find the Asset's primary (oldest) transaction — stage tasks hang off
 *  it so they appear in that transaction's TaskPanel. */
async function primaryTransactionId(
  db: Db,
  assetId: string,
): Promise<string | null> {
  const txn = await db.transaction.findFirst({
    where: { assetId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return txn?.id ?? null;
}

/**
 * Seed the first stage of the Asset's strategy lifecycle: set
 * currentStageName and instantiate that stage's human tasks. No-op for
 * strategies without a lifecycle (retail). Idempotent.
 */
export async function applyStrategyTemplate(
  db: Db,
  opts: { assetId: string; transactionId?: string },
): Promise<{ applied: boolean; stageKey: string | null; created: number }> {
  const asset = await db.asset.findUnique({
    where: { id: opts.assetId },
    select: { id: true, strategy: true, currentStageName: true },
  });
  if (!asset) return { applied: false, stageKey: null, created: 0 };
  const strategy = asset.strategy as Strategy;
  if (!hasStageLifecycle(strategy)) {
    return { applied: false, stageKey: null, created: 0 };
  }
  const stage = firstStage(strategy);
  if (!stage) return { applied: false, stageKey: null, created: 0 };

  const txnId =
    opts.transactionId ?? (await primaryTransactionId(db, asset.id));
  if (!txnId) return { applied: false, stageKey: null, created: 0 };

  const created = await instantiateStage(db, {
    assetId: asset.id,
    transactionId: txnId,
    stage,
  });
  await db.asset.update({
    where: { id: asset.id },
    data: { currentStageName: stage.key },
  });
  return { applied: true, stageKey: stage.key, created };
}

/** Month key (YYYY-MM) used to tag recurring task instances. */
export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Recurring-task engine (spec §7): for an Asset sitting in a recurring
 * stage (Rental Under-Management, Creative Loan-Servicing), generate
 * this month's task set. Tasks are tagged `templateKey = key#YYYY-MM`
 * so each month gets its own set and re-runs are idempotent. Safe to
 * call daily from the morning tick — it only creates the missing month.
 */
export async function generateRecurringTasks(
  db: Db,
  opts: { assetId: string; asOf?: Date },
): Promise<{ generated: number; monthKey: string | null }> {
  const asset = await db.asset.findUnique({
    where: { id: opts.assetId },
    select: { id: true, strategy: true, currentStageName: true },
  });
  if (!asset?.currentStageName) return { generated: 0, monthKey: null };
  const strategy = asset.strategy as Strategy;
  if (!isRecurringStage(strategy, asset.currentStageName)) {
    return { generated: 0, monthKey: null };
  }
  const stage = stageByKey(strategy, asset.currentStageName);
  if (!stage) return { generated: 0, monthKey: null };
  const txnId = await primaryTransactionId(db, asset.id);
  if (!txnId) return { generated: 0, monthKey: null };

  const monthKey = monthKeyOf(opts.asOf ?? new Date());
  let generated = 0;
  for (const t of humanTasks(stage)) {
    const templateKey = `${t.key}#${monthKey}`;
    const exists = await db.task.findFirst({
      where: { assetId: asset.id, stageKey: stage.key, templateKey },
      select: { id: true },
    });
    if (exists) continue;
    await db.task.create({
      data: {
        transactionId: txnId,
        assetId: asset.id,
        stageKey: stage.key,
        templateKey,
        title: `${t.name} (${monthKey})`,
        description: `${stage.name} · recurring · owner: ${t.ownerRole}`,
      },
    });
    generated++;
  }
  return { generated, monthKey };
}

/**
 * Set an Asset to a SPECIFIC stage (used by the kanban board when a card
 * is dragged to an arbitrary column — vs advanceStage which only steps
 * forward by one). Sets currentStageName and instantiates that stage's
 * tasks (idempotent). Validates the stage belongs to the strategy.
 */
export async function setStage(
  db: Db,
  opts: { assetId: string; stageKey: string },
): Promise<{ ok: boolean; stageKey: string | null; created: number }> {
  const asset = await db.asset.findUnique({
    where: { id: opts.assetId },
    select: { id: true, strategy: true },
  });
  if (!asset) return { ok: false, stageKey: null, created: 0 };
  const strategy = asset.strategy as Strategy;
  const stage = stageByKey(strategy, opts.stageKey);
  if (!stage) return { ok: false, stageKey: null, created: 0 };
  const txnId = await primaryTransactionId(db, asset.id);
  if (!txnId) return { ok: false, stageKey: null, created: 0 };

  const created = await instantiateStage(db, {
    assetId: asset.id,
    transactionId: txnId,
    stage,
  });
  await db.asset.update({
    where: { id: asset.id },
    data: { currentStageName: stage.key },
  });
  return { ok: true, stageKey: stage.key, created };
}

/** True when every human task in the Asset's current stage is complete. */
export async function isCurrentStageComplete(
  db: Db,
  assetId: string,
): Promise<boolean> {
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    select: { strategy: true, currentStageName: true },
  });
  if (!asset?.currentStageName) return false;
  const stage = stageByKey(asset.strategy as Strategy, asset.currentStageName);
  if (!stage) return false;
  const open = await db.task.count({
    where: {
      assetId,
      stageKey: stage.key,
      completedAt: null,
    },
  });
  return open === 0;
}

/**
 * Advance the Asset to the next stage and instantiate its tasks.
 * Returns the transition. When already at the final stage, returns
 * done=true and makes no change.
 */
export async function advanceStage(
  db: Db,
  opts: { assetId: string },
): Promise<{
  advanced: boolean;
  done: boolean;
  from: string | null;
  to: string | null;
  created: number;
}> {
  const asset = await db.asset.findUnique({
    where: { id: opts.assetId },
    select: { id: true, strategy: true, currentStageName: true },
  });
  if (!asset) {
    return { advanced: false, done: false, from: null, to: null, created: 0 };
  }
  const strategy = asset.strategy as Strategy;
  const from = asset.currentStageName;

  // If no current stage yet, advancing means applying the first stage.
  if (!from) {
    const r = await applyStrategyTemplate(db, { assetId: asset.id });
    return {
      advanced: r.applied,
      done: false,
      from: null,
      to: r.stageKey,
      created: r.created,
    };
  }

  const next = nextStage(strategy, from);
  if (!next) {
    return { advanced: false, done: true, from, to: null, created: 0 };
  }

  const txnId = await primaryTransactionId(db, asset.id);
  if (!txnId) {
    return { advanced: false, done: false, from, to: null, created: 0 };
  }

  const created = await instantiateStage(db, {
    assetId: asset.id,
    transactionId: txnId,
    stage: next,
  });
  await db.asset.update({
    where: { id: asset.id },
    data: { currentStageName: next.key },
  });
  return { advanced: true, done: false, from, to: next.key, created };
}
