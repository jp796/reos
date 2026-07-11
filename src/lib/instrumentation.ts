/**
 * Golden-workflow instrumentation (remediation Phase 9 / §15).
 *
 * Records the contract-to-close activation funnel as structured events on
 * the existing AutomationAuditLog spine (no new table). Never logs document
 * contents, tokens, passwords, or unnecessary PII (§15 final rule) — the
 * sanitizer enforces that.
 */

import type { PrismaClient } from "@prisma/client";

export type WorkflowEvent =
  | "intake_started"
  | "attachment_received"
  | "extraction_started"
  | "extraction_completed"
  | "extraction_failed"
  | "review_opened"
  | "facts_approved"
  | "timeline_approved"
  | "tasks_activated"
  | "first_risk_created"
  | "risk_resolved"
  | "compliance_review_ready"
  | "compliance_exported"
  | "transaction_closed";

export const WORKFLOW_EVENTS: readonly WorkflowEvent[] = [
  "intake_started",
  "attachment_received",
  "extraction_started",
  "extraction_completed",
  "extraction_failed",
  "review_opened",
  "facts_approved",
  "timeline_approved",
  "tasks_activated",
  "first_risk_created",
  "risk_resolved",
  "compliance_review_ready",
  "compliance_exported",
  "transaction_closed",
];

// Keys that must never be persisted in analytics metadata.
const FORBIDDEN_KEYS = /token|secret|password|authorization|cookie|raw|bytes|content|body|ssn|dob|account_?number|card/i;

/**
 * Strip PII / secrets / heavy blobs from event metadata. Keeps only small
 * scalar values (numbers, booleans, short strings, ISO dates) whose keys
 * are not sensitive. Never throws.
 */
export function sanitizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_KEYS.test(k)) continue;
    if (v == null) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 120);
    // objects/arrays/buffers are dropped — no free-text or blobs in analytics
  }
  return out;
}

export function buildEventRecord(opts: {
  accountId: string;
  transactionId?: string | null;
  event: WorkflowEvent;
  meta?: Record<string, unknown>;
  actorUserId?: string | null;
}) {
  return {
    accountId: opts.accountId,
    transactionId: opts.transactionId ?? null,
    entityType: "workflow_event" as const,
    entityId: null,
    ruleName: `golden:${opts.event}`,
    actionType: "event" as const,
    sourceType: "instrumentation" as const,
    confidenceScore: 1.0,
    decision: "applied" as const,
    beforeJson: undefined,
    afterJson: sanitizeMeta(opts.meta),
    actorUserId: opts.actorUserId ?? null,
  };
}

/** Fire-and-forget: log a workflow event. Never throws into the caller. */
export async function logWorkflowEvent(
  db: PrismaClient,
  opts: {
    accountId: string;
    transactionId?: string | null;
    event: WorkflowEvent;
    meta?: Record<string, unknown>;
    actorUserId?: string | null;
  },
): Promise<void> {
  try {
    const rec = buildEventRecord(opts);
    await db.automationAuditLog.create({
      data: {
        accountId: rec.accountId,
        transactionId: rec.transactionId,
        entityType: rec.entityType,
        entityId: rec.entityId,
        ruleName: rec.ruleName,
        actionType: rec.actionType,
        sourceType: rec.sourceType,
        confidenceScore: rec.confidenceScore,
        decision: rec.decision,
        afterJson: rec.afterJson as never,
        actorUserId: rec.actorUserId,
      },
    });
  } catch {
    // instrumentation never breaks the workflow
  }
}
