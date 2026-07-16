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

import type { Strategy, CreativeSubstructure } from "./DealClassifierService";

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
  /** Creative-finance sub-structure gate. When set, the task is only
   *  instantiated for a deal whose creativeSubstructure is in this list
   *  (e.g. a land-trust task only for subject_to). Tasks with no `subs`
   *  are the shared CF core (or apply to every non-creative strategy). */
  subs?: CreativeSubstructure[];
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
  /** The stage where the deal "goes to market" — sale/lease comms begin.
   *  Investor deals keep Gmail/SmartFolder OFF until they reach this
   *  stage (no inbox noise during acquisition + rehab), then activate.
   *  Retail deals ignore this (Gmail is on from creation). */
  marketEntry?: boolean;
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
    marketEntry: true,
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

// ── Flip — 7 stages (spec §6.1) ───────────────────────────────────────
const FLIP: StageTemplate[] = [
  {
    key: "potential",
    name: "Potential (Ready to Offer)",
    order: 0,
    tasks: [
      { key: "disposition_analysis", name: "Run disposition analyses", ownerRole: "agent" },
      { key: "visit", name: "Visit property", ownerRole: "agent" },
      { key: "reno_estimate", name: "Reno estimates from contractor", ownerRole: "contractor" },
      { key: "arv_realtors", name: "ARV from realtors", ownerRole: "agent" },
      { key: "lock_arv_mao", name: "Lock ARV + MAO", ownerRole: "agent" },
      { key: "confirm_contractor", name: "Identify / confirm contractor", ownerRole: "agent" },
      { key: "confirm_lender", name: "Identify / confirm private lender", ownerRole: "agent" },
      { key: "inspections", name: "Get completed inspections", ownerRole: "inspector" },
      { key: "closing_fees", name: "Identify closing fees", ownerRole: "agent" },
      { key: "comps", name: "Document comps", ownerRole: "agent" },
      { key: "confirm_agent", name: "Identify / confirm agent", ownerRole: "agent" },
      { key: "verify_jp", name: "Verify analysis with JP", ownerRole: "agent" },
      { key: "offer", name: "Offer", ownerRole: "agent" },
      { key: "accepted_details", name: "Accepted offer details", ownerRole: "agent" },
    ],
  },
  {
    key: "under_contract_purchase",
    name: "Under Contract → Purchase",
    order: 1,
    tasks: [
      { key: "notice_of_interest", name: "Notice of interest filed", ownerRole: "agent" },
      { key: "closing_date_purchase", name: "Closing date to purchase", ownerRole: "title" },
      { key: "scaffold_drive_chat", name: "Drive folder + Chat space", ownerRole: "agent", auto: true },
      { key: "inspections", name: "Inspections", ownerRole: "inspector" },
      { key: "due_diligence", name: "Due diligence", ownerRole: "agent" },
      { key: "lender_agreement", name: "Private lender agreement", ownerRole: "lender" },
      { key: "contractor_agreement", name: "Contractor agreement", ownerRole: "contractor" },
      { key: "review_title", name: "Review title docs", ownerRole: "agent" },
      { key: "repairs", name: "Repairs", ownerRole: "contractor" },
      { key: "schedule_utilities", name: "Schedule utilities", ownerRole: "agent" },
      { key: "builders_risk", name: "Property / builder's-risk insurance", ownerRole: "agent" },
      { key: "email_title_co", name: "Choose + email title company", ownerRole: "title" },
      { key: "wire_emd", name: "Wire EMD", ownerRole: "client" },
      { key: "sow_walkthrough", name: "SOW + design walkthrough", ownerRole: "agent" },
      { key: "upload_purchase_agreement", name: "Upload purchase agreement", ownerRole: "agent" },
    ],
  },
  // ── Consolidation (FLAG 1): the MIDDLE of a flip — Rehab + Prep-to-List —
  //    now lives ONLY in the Project (projectTemplates.ts flip_rehab), and the
  //    BACK-END — On Market / Pending / Sold — lives on the disposition
  //    transaction (DISPOSITION_TASKS in ProjectEngine.ts). The flat flip
  //    lifecycle keeps only the acquisition front-end above so nothing
  //    double-ups with the Project. ───────────────────────────────────────
];

// ── Rental / BRRRR — 6 stages (spec §6.3) ─────────────────────────────
const RENTAL_BRRRR: StageTemplate[] = [
  {
    key: "lead_analysis",
    name: "Lead Gen & Deal Analysis",
    order: 0,
    tasks: [
      { key: "research_property", name: "Research property", ownerRole: "agent" },
      { key: "estimate_arv", name: "Estimate ARV (for refi appraisal)", ownerRole: "agent" },
      { key: "estimate_rent", name: "Estimate market rent", ownerRole: "agent" },
      { key: "estimate_repairs", name: "Estimate repairs", ownerRole: "agent" },
      { key: "calc_mao", name: "MAO (purchase+rehab+holding ≤ ~75% ARV)", ownerRole: "agent" },
      { key: "brrrr_model", name: "Run BRRRR / DSCR model (capital-left-in)", ownerRole: "agent" },
      { key: "visit", name: "Visit", ownerRole: "agent" },
      { key: "verify_jp", name: "Verify with JP", ownerRole: "agent" },
      { key: "offer", name: "Offer", ownerRole: "agent" },
      { key: "accepted_details", name: "Accepted offer details", ownerRole: "agent" },
    ],
  },
  {
    key: "under_contract_purchase",
    name: "Under Contract (Purchase)",
    order: 1,
    tasks: [
      { key: "execute_psa", name: "Execute PSA", ownerRole: "agent" },
      { key: "emd", name: "EMD", ownerRole: "client" },
      { key: "title_review", name: "Title search / review", ownerRole: "title" },
      { key: "inspections_dd", name: "Inspections / DD", ownerRole: "inspector" },
      { key: "acquisition_financing", name: "Acquisition / bridge financing", ownerRole: "lender" },
      { key: "builders_risk", name: "Builder's risk", ownerRole: "agent" },
      { key: "contractor_sow", name: "Contractor agreement + SOW", ownerRole: "contractor" },
      { key: "scaffold_drive_chat", name: "Drive + Chat space", ownerRole: "agent", auto: true },
      { key: "upload_docs", name: "Upload docs", ownerRole: "agent" },
      { key: "email_title", name: "Choose + email title", ownerRole: "title" },
      { key: "wire_emd", name: "Wire EMD", ownerRole: "client" },
      { key: "close", name: "Close (deed + mortgage)", ownerRole: "title" },
    ],
  },
  // ── Consolidation (FLAG 1 + FLAG 3): the MIDDLE of a BRRRR — Renovations,
  //    Lease-Up, AND the cash-out Refinance step — now live ONLY in the
  //    Project (projectTemplates.ts rental_rent_ready). A rental never sells,
  //    so there is NO disposition transaction; when the project completes the
  //    asset moves straight to the recurring Under-Management hold below. ──
  {
    key: "under_management",
    name: "Under Management",
    order: 2,
    isRecurring: true,
    tasks: [
      { key: "rent_collection", name: "Monthly rent collection", ownerRole: "agent" },
      { key: "pl_update", name: "Monthly P&L update", ownerRole: "agent" },
      { key: "maintenance", name: "Maintenance handling", ownerRole: "agent" },
      { key: "periodic_inspection", name: "Periodic inspections", ownerRole: "inspector" },
      { key: "lease_renewal", name: "Lease renewal / annual rent review", ownerRole: "agent" },
      { key: "escrow_tracking", name: "Tax + insurance escrow tracking", ownerRole: "agent" },
      { key: "schedule_e", name: "Year-end Schedule E", ownerRole: "agent" },
      { key: "partner_updates", name: "Recurring partner / lender updates", ownerRole: "agent" },
    ],
  },
];

// ── Creative Finance — 6 stages (spec §6.4, compliance-heavy §13) ─────
const CREATIVE: StageTemplate[] = [
  {
    key: "lead_analysis",
    name: "Lead Gen & Deal Analysis (term-driven)",
    order: 0,
    tasks: [
      { key: "seller_motivation", name: "Identify seller situation / motivation", ownerRole: "agent" },
      { key: "pull_loan_details", name: "Pull existing loan details (balance, rate, payment, escrow, due-on-sale)", ownerRole: "agent" },
      { key: "determine_structure", name: "Determine structure", ownerRole: "agent" },
      { key: "calc_terms", name: "Calculate entry cost + monthly cash flow + exit/balloon", ownerRole: "agent" },
      { key: "attorney_review", name: "Attorney review of structure", ownerRole: "agent" },
      { key: "visit", name: "Visit", ownerRole: "agent" },
      { key: "verify_jp", name: "Verify with JP", ownerRole: "agent" },
      { key: "offer_terms", name: "Offer (with terms)", ownerRole: "agent" },
      { key: "accepted_details", name: "Accepted offer details", ownerRole: "agent" },
    ],
  },
  {
    key: "structuring",
    name: "Under Contract / Structuring",
    order: 1,
    tasks: [
      // ── Shared CF core ──
      { key: "attorney_draft", name: "Attorney drafts the instruments for this structure", ownerRole: "agent" },
      { key: "authorization_release", name: "Authorization to Release / Limited POA to loan servicer", ownerRole: "agent" },
      { key: "title_insurance", name: "Title search + title insurance (confirm underlying loan/liens)", ownerRole: "title" },
      { key: "insurance_transfer", name: "Insurance transfer / add insured (watch due-on-sale trigger)", ownerRole: "agent" },
      { key: "scaffold_drive_chat", name: "Drive + Chat space", ownerRole: "agent", auto: true },
      { key: "upload_executed_docs", name: "Upload all executed docs", ownerRole: "agent" },
      // ── Subject-to ──
      { key: "sub2_deed", name: "Execute + record warranty deed into land trust", ownerRole: "title", subs: ["subject_to"] },
      { key: "land_trust", name: "Set up land trust + assign beneficial interest (due-on-sale shield)", ownerRole: "agent", subs: ["subject_to"] },
      { key: "loan_servicing_setup", name: "Set up third-party loan servicing for the underlying loan", ownerRole: "agent", subs: ["subject_to"] },
      { key: "underlying_payment_method", name: "Establish underlying-mortgage payment method", ownerRole: "agent", subs: ["subject_to"] },
      { key: "confirm_loan_current", name: "Confirm seller's loan current (reinstate arrears if any)", ownerRole: "agent", subs: ["subject_to"] },
      { key: "due_on_sale_plan", name: "Due-on-sale risk plan", ownerRole: "agent", subs: ["subject_to"] },
      // ── Owner carry (seller financing, free & clear) ──
      { key: "promissory_note", name: "Promissory note + deed of trust + amortization schedule", ownerRole: "agent", subs: ["seller_finance"] },
      { key: "dodd_frank", name: "Dodd-Frank / SAFE compliance check — verify w/ counsel or RMLO (owner-occupant)", ownerRole: "agent", subs: ["seller_finance"] },
      { key: "record_deed_dot", name: "Record deed to buyer + deed of trust to seller", ownerRole: "title", subs: ["seller_finance"] },
      // ── Lease option ──
      { key: "lease_option_docs", name: "Execute lease + SEPARATE option agreement (avoid equitable-mortgage recharacterization)", ownerRole: "agent", subs: ["lease_option"] },
      { key: "option_consideration", name: "Collect option consideration + set rent-credit terms", ownerRole: "agent", subs: ["lease_option"] },
      { key: "memorandum_option", name: "Record Memorandum of Option (protect equitable interest)", ownerRole: "title", subs: ["lease_option"] },
    ],
  },
  {
    key: "stabilization",
    name: "Stabilization (optional)",
    order: 2,
    tasks: [
      { key: "light_rehab", name: "Light rehab (reuse draw cycle)", ownerRole: "contractor" },
      { key: "tenant_placement", name: "Tenant placement (reuse Lease-Up)", ownerRole: "agent" },
      { key: "hold_as_is", name: "Or occupy / hold as-is", ownerRole: "agent" },
    ],
  },
  {
    key: "loan_servicing_hold",
    name: "Loan Servicing & Hold",
    order: 3,
    isRecurring: true,
    tasks: [
      { key: "pay_underlying", name: "Pay underlying mortgage ON TIME (top-severity recurring)", ownerRole: "agent", subs: ["subject_to"] },
      { key: "monitor_loan", name: "Monitor underlying loan", ownerRole: "agent", subs: ["subject_to"] },
      { key: "monitor_due_on_sale", name: "Monitor due-on-sale exposure", ownerRole: "agent", subs: ["subject_to"] },
      { key: "collect_payment", name: "Collect tenant / buyer payment", ownerRole: "agent" },
      { key: "payment_reconciliation", name: "Monthly payment reconciliation", ownerRole: "agent" },
      { key: "track_balloon", name: "Track balloon / exit / option-expiration date (lead-time alerts)", ownerRole: "agent" },
      { key: "periodic_statements", name: "Send periodic statements", ownerRole: "agent" },
      { key: "annual_1098", name: "Annual 1098 to buyer (you're the lender)", ownerRole: "agent", subs: ["seller_finance"] },
      { key: "insurance_renewal", name: "Insurance renewal tracking", ownerRole: "agent" },
    ],
  },
  {
    key: "exit_payoff",
    name: "Exit / Payoff",
    order: 4,
    tasks: [
      { key: "trigger_exit", name: "Trigger exit plan (refi/sell/seller-finance/option exercised)", ownerRole: "agent" },
      { key: "order_payoff", name: "Order payoff statement", ownerRole: "agent" },
      { key: "coordinate_exit_closing", name: "Coordinate exit closing", ownerRole: "title" },
      { key: "release_note", name: "Satisfy / release note or DOT", ownerRole: "title" },
      { key: "notify_seller_payoff", name: "Notify seller of payoff (clears liability)", ownerRole: "agent" },
      { key: "final_reconciliation", name: "Final reconciliation + return calc", ownerRole: "agent" },
    ],
  },
  {
    key: "closed",
    name: "Deal Closed",
    order: 5,
    tasks: [
      { key: "upload_closing_docs", name: "Upload closing docs", ownerRole: "agent" },
      { key: "settlement_to_bookkeeper", name: "Settlement statement to bookkeeper", ownerRole: "agent" },
      { key: "update_production", name: "Update Production / CRM", ownerRole: "agent", auto: true },
      { key: "archive", name: "Archive Drive + board", ownerRole: "agent", auto: true },
    ],
  },
];

/** Strategy → lifecycle. Empty array = the strategy has no stage
 *  lifecycle (retail uses the existing milestone/checklist flow). */
export const STRATEGY_TEMPLATES: Record<Strategy, StageTemplate[]> = {
  retail: [], // retail uses the existing milestone/checklist flow, not stages
  // Wholetail has no flat-stage lifecycle: its acquisition uses the normal
  // transaction flow and its make-ready PROJECT phase is driven by
  // ProjectEngine + projectTemplates (then a disposition transaction).
  wholetail: [],
  wholesale: WHOLESALE,
  flip: FLIP,
  rental_brrrr: RENTAL_BRRRR,
  creative: CREATIVE,
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
export function humanTasks(
  stage: StageTemplate,
  sub?: CreativeSubstructure | null,
): TaskTemplate[] {
  return stage.tasks.filter((t) => {
    if (t.auto) return false;
    // Substructure-gated tasks only apply to the matching sub-structure.
    // A task with no `subs` is shared core and always applies.
    if (t.subs && t.subs.length > 0) {
      return sub != null && t.subs.includes(sub);
    }
    return true;
  });
}

/** True when the given stage of a strategy is recurring (hold/servicing
 *  — Rental Under-Management, Creative Loan-Servicing). */
export function isRecurringStage(
  strategy: Strategy,
  stageKey: string | null | undefined,
): boolean {
  if (!stageKey) return false;
  return stageByKey(strategy, stageKey)?.isRecurring === true;
}

/** The "go to market" stage for a strategy (where sale/lease comms — and
 *  Gmail activation — begin), or null if the strategy has none. */
export function marketEntryStage(strategy: Strategy): StageTemplate | null {
  return getStrategyTemplate(strategy).find((s) => s.marketEntry) ?? null;
}

/**
 * Has an investor deal reached the point where Gmail should turn on?
 * True once currentStage's order >= the market-entry stage's order. A
 * strategy with no market-entry stage (e.g. creative hold) returns false
 * — Gmail stays manual-only there. Strategies with no lifecycle
 * (retail) are handled by the caller (Gmail on from creation).
 */
export function hasReachedMarketEntry(
  strategy: Strategy,
  currentStageKey: string | null | undefined,
): boolean {
  const entry = marketEntryStage(strategy);
  if (!entry) return false;
  if (!currentStageKey) return false;
  const current = stageByKey(strategy, currentStageKey);
  if (!current) return false;
  return current.order >= entry.order;
}
