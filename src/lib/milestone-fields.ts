/**
 * Single source of truth for the milestone-type ↔ Transaction-date-field
 * mapping. Dates live in BOTH places — Milestone rows (the timeline) and
 * scalar Transaction columns (the header, Details tab, Today, calendar
 * sync). Editing one must keep the other in sync so no view goes stale.
 *
 * Used by:
 *   - PATCH /milestones/:mid  (timeline edit → Transaction field)
 *   - Atlas set_deadline / set_deadline UIs (Transaction field → milestone)
 */

/** milestone.type → Transaction scalar date column (Prisma field name). */
export const MILESTONE_TYPE_TO_TXN_FIELD: Record<string, string> = {
  contract_effective: "contractDate",
  earnest_money: "earnestMoneyDueDate",
  inspection: "inspectionDate",
  inspection_objection: "inspectionObjectionDate",
  title_commitment: "titleDeadline",
  title_objection: "titleObjectionDate",
  financing_approval: "financingDeadline",
  appraisal: "appraisalDate",
  walkthrough: "walkthroughDate",
  closing: "closingDate",
  possession: "possessionDate",
};

/** Reverse: Transaction date field → milestone.type (for field-first edits). */
export const TXN_FIELD_TO_MILESTONE_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(MILESTONE_TYPE_TO_TXN_FIELD).map(([type, field]) => [field, type]),
);
