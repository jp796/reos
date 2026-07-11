/**
 * Canonical transaction-state view-model (remediation Phase 2 / §8).
 *
 * Dates, extraction, reconciliation, timeline, comms-sync, and AI-brief
 * state each live as timestamps/flags across the Transaction row. The UI
 * must NOT independently infer ambiguous phrases like "reconciled" or
 * "synced". This module is the ONE place that derives every state label
 * from the raw fields, so no surface can render a contradiction such as
 * "reconciled across all documents · synced never" (which shipped before).
 *
 * Rules enforced (§8):
 *   - Never "reconciled/current" without a real success timestamp (§8.1/8.2).
 *   - "never synced" is an ACTIONABLE state, not metadata beside a claim (§8.3).
 *   - Every failure/empty state carries recovery guidance (§8.4).
 *   - Every material state exposes its last-success timestamp (§8.5).
 *   - Labels come from THIS formatter, not inline JSX (§8.6).
 */

export type Phase = "not_started" | "processing" | "needs_review" | "current" | "stale" | "failed";

export interface DimensionState {
  key: string;
  /** short machine state */
  state: Phase;
  /** human label, contradiction-free */
  label: string;
  /** last successful action, ISO or null */
  since: string | null;
  /** actionable un-done state → what to do */
  action: string | null;
  /** display tone hint */
  tone: "muted" | "warn" | "danger" | "ok";
}

export interface TransactionStateInput {
  contractExtractedAt: string | null;
  contractAppliedAt: string | null;
  pendingContractJson: unknown | null;
  synthesizedAt: string | null;
  lastSyncedAt: string | null;
  googleConnected: boolean;
  aiSummaryUpdatedAt: string | null;
  milestoneCount: number;
  /** newest document uploaded after the last synthesis → timeline may be stale */
  newestDocAt: string | null;
  status: string; // active | closed | dead | terminated | pending
}

function isAfter(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return new Date(a).getTime() > new Date(b).getTime();
}

/** Extraction/review state — has the contract been read + approved? */
export function extractionState(i: TransactionStateInput): DimensionState {
  if (i.contractAppliedAt) {
    return { key: "extraction", state: "current", label: "Reviewed + applied", since: i.contractAppliedAt, action: null, tone: "ok" };
  }
  if (i.pendingContractJson) {
    return { key: "extraction", state: "needs_review", label: "Extracted — needs your review", since: i.contractExtractedAt, action: "Review the extracted facts, then Apply", tone: "warn" };
  }
  if (i.contractExtractedAt) {
    return { key: "extraction", state: "processing", label: "Read the contract", since: i.contractExtractedAt, action: null, tone: "muted" };
  }
  return { key: "extraction", state: "not_started", label: "No contract read yet", since: null, action: "Upload or scan the contract", tone: "warn" };
}

/** Document reconciliation (synthesis) — NEVER claims reconciled w/o a timestamp. */
export function reconciliationState(i: TransactionStateInput): DimensionState {
  if (!i.synthesizedAt) {
    return { key: "reconciliation", state: "not_started", label: "Not synced yet", since: null, action: "Sync from documents to reconcile the contract + addenda", tone: "warn" };
  }
  if (isAfter(i.newestDocAt, i.synthesizedAt)) {
    return { key: "reconciliation", state: "stale", label: "New document not yet reconciled", since: i.synthesizedAt, action: "Re-sync from documents", tone: "warn" };
  }
  return { key: "reconciliation", state: "current", label: "Reconciled across all documents", since: i.synthesizedAt, action: null, tone: "ok" };
}

/** Timeline — built from milestones; stale if a newer doc arrived post-sync. */
export function timelineState(i: TransactionStateInput): DimensionState {
  if (i.milestoneCount === 0) {
    return { key: "timeline", state: "not_started", label: "No timeline yet", since: null, action: "Apply the contract to build the timeline", tone: "warn" };
  }
  if (isAfter(i.newestDocAt, i.synthesizedAt) && !!i.synthesizedAt) {
    return { key: "timeline", state: "stale", label: "Timeline may be stale", since: i.synthesizedAt, action: "Re-sync to fold in the new document", tone: "warn" };
  }
  return { key: "timeline", state: "current", label: "Timeline built", since: i.contractAppliedAt ?? i.synthesizedAt, action: null, tone: "ok" };
}

/** Communications sync — disconnected / never / current, actionable. */
export function commsSyncState(i: TransactionStateInput): DimensionState {
  if (!i.googleConnected) {
    return { key: "comms", state: "failed", label: "Gmail not connected", since: null, action: "Connect Google in Settings → Integrations", tone: "danger" };
  }
  if (!i.lastSyncedAt) {
    return { key: "comms", state: "not_started", label: "Never synced", since: null, action: "Run a Gmail scan", tone: "warn" };
  }
  return { key: "comms", state: "current", label: "Synced", since: i.lastSyncedAt, action: null, tone: "ok" };
}

/** AI brief — generated / stale / not generated. */
export function aiBriefState(i: TransactionStateInput): DimensionState {
  if (!i.aiSummaryUpdatedAt) {
    return { key: "ai_brief", state: "not_started", label: "No AI brief yet", since: null, action: "Generate a status brief", tone: "muted" };
  }
  return { key: "ai_brief", state: "current", label: "AI brief current", since: i.aiSummaryUpdatedAt, action: null, tone: "ok" };
}

/** Full canonical state for a transaction. */
export function transactionState(i: TransactionStateInput): DimensionState[] {
  return [
    extractionState(i),
    reconciliationState(i),
    timelineState(i),
    commsSyncState(i),
    aiBriefState(i),
  ];
}
