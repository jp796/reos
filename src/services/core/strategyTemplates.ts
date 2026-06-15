/**
 * strategyTemplates — strategy lifecycles as deterministic data (spec §6).
 *
 * A Stage is a scoped task template. Completing a stage auto-advances
 * the Asset and instantiates the next stage's tasks (engine in
 * StageEngine.ts). `auto: true` marks a SYSTEM action (Drive scaffold,
 * CRM update, archive) — not a human to-do; the engine performs/marks
 * these rather than queueing them for a person.
 *
 * Phase 1 ships Wholesale (spec §6.2). Flip / Rental / Creative land in
 * later phases; their keys are reserved here so the registry shape is
 * stable.
 *
 * Pure module — no DB, no side effects. The engine maps these specs
 * onto Task rows.
 */

import type { Strategy } from "./DealClassifierService";

export type OwnerRole =
  | "agent"
  | "lender"
  | "title"
  | "inspector"
  | "client"
  | "contractor";

export interface TaskTemplate {
  /** Stable within a stage — used to dedupe re-instantiation. */
  key: string;
  name: string;
  ownerRole: OwnerRole;
  /** System action (no human owner) — engine completes it, doesn't queue it. */
  auto?: boolean;
}

export interface StageTemplate {
  key: string;
  name: string;
  /** 0-based position in the lifecycle. */
  order: number;
  tasks: TaskTemplate[];
  /** Recurring hold/servicing stage (Rental Under-Management, Creative
   *  Loan-Servicing) — does not terminate. Phase 3+. */
  isRecurring?: boolean;
}

// ── Wholesale — 5 stages (spec §6.2) ──────────────────────────────────
const WHOLESALE: StageTemplate[] = [
  {
    key: "lead_analysis",
    name: "Lead Gen & Deal Analysis",
    order: 0,
    tasks: [
      { key: "research_property", name: "Research property (title, liens)", ownerRole: "agent" },
      { key: "estimate_arv", name: "Estimate ARV", ownerRole: "agent" },
      { key: "visit", name: "Drive-by / visit property", ownerRole: "agent" },
      { key: "calc_mao", name: "Calculate MAO", ownerRole: "agent" },
      { key: "estimate_repairs", name: "Estimate repair costs", ownerRole: "agent" },
      { key: "motivated_seller", name: "Identify motivated-seller situation", ownerRole: "agent" },
      { key: "verify_jp", name: "Verify analysis with JP", ownerRole: "agent" },
      { key: "make_offer", name: "Make offer", ownerRole: "agent" },
      { key: "accepted_details", name: "Record accepted offer details", ownerRole: "agent" },
    ],
  },
  {
    key: "under_contract",
    name: "Under Contract",
    order: 1,
    tasks: [
      { key: "execute_psa", name: "Execute PSA", ownerRole: "agent" },
      { key: "submit_emd", name: "Submit EMD", ownerRole: "client" },
      { key: "notice_of_interest", name: "Notice of interest filed", ownerRole: "agent" },
      { key: "order_title", name: "Order title search", ownerRole: "title" },
      { key: "review_title", name: "Review title docs", ownerRole: "agent" },
      { key: "scaffold_drive_chat", name: "Drive folder + Chat space", ownerRole: "agent", auto: true },
      { key: "upload_contract", name: "Upload contract docs", ownerRole: "agent" },
      { key: "confirm_assignment_clause", name: "Confirm assignment clause", ownerRole: "agent" },
      { key: "schedule_inspection", name: "Schedule inspection (if needed)", ownerRole: "inspector" },
      { key: "set_contingency_deadlines", name: "Set contingency deadlines", ownerRole: "agent" },
      { key: "upload_photos", name: "Upload photos", ownerRole: "agent" },
      { key: "email_title_co", name: "Choose + email title company", ownerRole: "title" },
    ],
  },
  {
    key: "disposition",
    name: "Marketing to Buyers / Disposition",
    order: 2,
    tasks: [
      { key: "photos_to_marketing", name: "Upload photos to marketing", ownerRole: "agent" },
      { key: "blast_cash_buyers", name: "Blast cash-buyers list", ownerRole: "agent" },
      { key: "post_platforms", name: "Post on wholesale platforms / FB", ownerRole: "agent" },
      { key: "schedule_showings", name: "Schedule buyer showings", ownerRole: "agent" },
      { key: "collect_pof", name: "Collect proof of funds", ownerRole: "agent" },
      { key: "negotiate_fee", name: "Negotiate assignment fee", ownerRole: "agent" },
      { key: "select_end_buyer", name: "Select end buyer", ownerRole: "agent" },
    ],
  },
  {
    key: "assignment_close",
    name: "Assignment / Double Close",
    order: 3,
    tasks: [
      { key: "execute_assignment", name: "Execute assignment agreement (or double close)", ownerRole: "agent" },
      { key: "collect_buyer_emd", name: "Collect buyer's EMD", ownerRole: "client" },
      { key: "send_assignment_title", name: "Send assignment / contract to title", ownerRole: "title" },
      { key: "confirm_title_docs", name: "Confirm title has all docs", ownerRole: "title" },
      { key: "schedule_closing", name: "Schedule closing", ownerRole: "title" },
      { key: "coordinate_closing", name: "Coordinate seller + buyer for closing", ownerRole: "agent" },
      { key: "approve_settlement", name: "Review + approve settlement statement", ownerRole: "agent" },
    ],
  },
  {
    key: "closed",
    name: "Deal Closed",
    order: 4,
    tasks: [
      { key: "upload_closing_docs", name: "Upload closing docs to Drive", ownerRole: "agent" },
      { key: "settlement_to_bookkeeper", name: "Settlement statement to bookkeeper", ownerRole: "agent" },
      { key: "update_production", name: "Update Production / CRM", ownerRole: "agent", auto: true },
      { key: "thank_you_seller", name: "Follow-up thank-you to seller", ownerRole: "agent" },
      { key: "followup_buyer", name: "Follow-up with buyer for future deals", ownerRole: "agent" },
      { key: "archive", name: "Archive Drive + board", ownerRole: "agent", auto: true },
    ],
  },
];

/** Strategy → lifecycle. Empty array = template not built yet (the
 *  strategy still classifies; it just has no stage lifecycle until its
 *  phase ships). */
export const STRATEGY_TEMPLATES: Record<Strategy, StageTemplate[]> = {
  retail: [], // retail uses the existing milestone/checklist flow, not stages
  wholesale: WHOLESALE,
  flip: [], // Phase 2
  rental_brrrr: [], // Phase 3
  creative: [], // Phase 4
};

export function getStrategyTemplate(strategy: Strategy): StageTemplate[] {
  return STRATEGY_TEMPLATES[strategy] ?? [];
}

/** True when the strategy has a stage lifecycle (i.e. is investor-PM). */
export function hasStageLifecycle(strategy: Strategy): boolean {
  return getStrategyTemplate(strategy).length > 0;
}

export function firstStage(strategy: Strategy): StageTemplate | null {
  return getStrategyTemplate(strategy)[0] ?? null;
}

export function stageByKey(
  strategy: Strategy,
  key: string,
): StageTemplate | null {
  return getStrategyTemplate(strategy).find((s) => s.key === key) ?? null;
}

/** The stage after `currentKey`, or null at the end of the lifecycle. */
export function nextStage(
  strategy: Strategy,
  currentKey: string,
): StageTemplate | null {
  const stages = getStrategyTemplate(strategy);
  const idx = stages.findIndex((s) => s.key === currentKey);
  if (idx === -1 || idx + 1 >= stages.length) return null;
  return stages[idx + 1];
}

/** Human (non-auto) tasks for a stage — the ones the engine queues. */
export function humanTasks(stage: StageTemplate): TaskTemplate[] {
  return stage.tasks.filter((t) => !t.auto);
}
