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
  {
    key: "rehab",
    name: "Rehab (Renovations)",
    order: 2,
    tasks: [
      { key: "closing_docs", name: "Closing docs", ownerRole: "agent" },
      { key: "reno_timeline", name: "Renovation timeline", ownerRole: "contractor" },
      { key: "lockbox", name: "Contractor lockbox", ownerRole: "agent" },
      { key: "change_orders", name: "Change orders", ownerRole: "contractor" },
      { key: "record_mortgage", name: "Record mortgage", ownerRole: "title" },
      { key: "draw_cycle", name: "Run draw cycle (request → verify → lien waiver → release)", ownerRole: "agent" },
      { key: "weekly_photos", name: "Weekly pictures / video", ownerRole: "agent" },
      { key: "weekly_contractor", name: "Weekly contractor update", ownerRole: "contractor" },
      { key: "biweekly_lender", name: "Bi-weekly private lender email", ownerRole: "agent" },
      { key: "punch_list", name: "Punch-list walkthrough", ownerRole: "agent" },
      { key: "monthly_expense", name: "Monthly expense update", ownerRole: "agent" },
    ],
  },
  {
    key: "prep_to_list",
    name: "Prep to List",
    order: 3,
    tasks: [
      { key: "cleaning", name: "Professional cleaning", ownerRole: "agent" },
      { key: "staging", name: "Soft staging", ownerRole: "agent" },
      { key: "photos", name: "Professional photos", ownerRole: "agent" },
      { key: "list_property", name: "List property", ownerRole: "agent" },
      { key: "invoices_net_sheet", name: "Invoices to Drive + net sheet", ownerRole: "agent" },
      { key: "home_warranty", name: "Home warranty", ownerRole: "agent" },
      { key: "walkthrough_video", name: "Walk-through video", ownerRole: "agent" },
      { key: "open_house", name: "Schedule open house", ownerRole: "agent" },
      { key: "listing_details", name: "Listing details", ownerRole: "agent" },
      { key: "monthly_expense", name: "Monthly expense update", ownerRole: "agent" },
    ],
  },
  {
    key: "on_market",
    name: "On Market",
    order: 4,
    tasks: [
      { key: "scaffold_drive", name: "Drive folder", ownerRole: "agent", auto: true },
      { key: "first_open_house", name: "1st open house", ownerRole: "agent" },
      { key: "open_house_schedule", name: "Open-house schedule", ownerRole: "agent" },
      { key: "email_lender_status", name: "Email private lender (new status)", ownerRole: "agent" },
      { key: "reeval_price", name: "Re-evaluate for price drop", ownerRole: "agent" },
      { key: "biweekly_lender", name: "Bi-weekly lender emails", ownerRole: "agent" },
      { key: "monthly_expense", name: "Monthly expense update", ownerRole: "agent" },
    ],
  },
  {
    key: "pending",
    name: "Pending",
    order: 5,
    tasks: [
      { key: "closing_date", name: "Closing date", ownerRole: "title" },
      { key: "buyer_repair_request", name: "Buyer repair request", ownerRole: "agent" },
      { key: "remove_staging", name: "Remove soft staging after appraisal", ownerRole: "agent" },
      { key: "bills_to_title", name: "Finalized bills to title", ownerRole: "title" },
      { key: "update_net_sheet", name: "Update seller net sheet", ownerRole: "agent" },
      { key: "finalize_pml_payoff", name: "Finalize private lender payoff", ownerRole: "agent" },
      { key: "approve_settlement", name: "Approve settlement statement", ownerRole: "agent" },
      { key: "mls_pending", name: "Update MLS to pending", ownerRole: "agent" },
      { key: "send_contract_title", name: "Send contract to title", ownerRole: "title" },
      { key: "warranty_buyer_name", name: "Home-warranty buyer-name update", ownerRole: "agent" },
      { key: "final_expense", name: "Final expense updates", ownerRole: "agent" },
    ],
  },
  {
    key: "sold",
    name: "Sold",
    order: 6,
    tasks: [
      { key: "notify_pml", name: "Notify PML of sale", ownerRole: "agent" },
      { key: "upload_closing_docs", name: "Upload closing docs to Drive", ownerRole: "agent" },
      { key: "settlement_insurance_bookkeeper", name: "Settlement statement to insurance + bookkeeper", ownerRole: "agent" },
      { key: "mls_sold", name: "Update MLS to sold", ownerRole: "agent" },
      { key: "pay_profit_splits", name: "Pay profit splits", ownerRole: "agent" },
      { key: "profit_reconciliation", name: "Profit reconciliation + post-mortem to Production", ownerRole: "agent" },
      { key: "release_retainage", name: "Release retainage to contractor", ownerRole: "agent" },
      { key: "remove_sign_lockbox", name: "Remove sign + lockbox", ownerRole: "agent" },
      { key: "archive", name: "Archive Drive + board", ownerRole: "agent", auto: true },
    ],
  },
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
  {
    key: "renovations",
    name: "Renovations (rent-ready spec)",
    order: 2,
    tasks: [
      { key: "rehab_kickoff", name: "Rehab kickoff (SOW + draw schedule)", ownerRole: "contractor" },
      { key: "draw_cycle", name: "Run draw cycle (lien waiver + retainage)", ownerRole: "agent" },
      { key: "weekly_photos", name: "Weekly photos + contractor update", ownerRole: "agent" },
      { key: "biweekly_lender", name: "Bi-weekly lender update", ownerRole: "agent" },
      { key: "holding_cost", name: "Holding-cost tracking", ownerRole: "agent" },
      { key: "punch_list", name: "Punch-list", ownerRole: "agent" },
    ],
  },
  {
    key: "lease_up",
    name: "Lease-Up (Tenant Placement)",
    order: 3,
    tasks: [
      { key: "make_ready", name: "Make-ready / clean", ownerRole: "agent" },
      { key: "landlord_insurance", name: "Switch to landlord / dwelling insurance", ownerRole: "agent" },
      { key: "set_rent_listing", name: "Set rent + create listing", ownerRole: "agent" },
      { key: "market_showings", name: "Market + schedule showings", ownerRole: "agent" },
      { key: "tenant_screening", name: "Tenant screening (app, credit/bg, income, refs)", ownerRole: "agent" },
      { key: "select_tenant", name: "Select tenant", ownerRole: "agent" },
      { key: "execute_lease", name: "Execute lease", ownerRole: "agent" },
      { key: "collect_deposit", name: "Collect deposit + first month", ownerRole: "client" },
      { key: "move_in_inspection", name: "Move-in inspection (photos)", ownerRole: "inspector" },
      { key: "rent_collection_setup", name: "Set up rent collection", ownerRole: "agent" },
      { key: "transfer_utilities", name: "Transfer utilities", ownerRole: "client" },
    ],
  },
  {
    key: "refinance",
    name: "Refinance (cash-out — 2nd closing)",
    order: 4,
    tasks: [
      { key: "order_appraisal", name: "Order appraisal", ownerRole: "lender" },
      { key: "submit_refi", name: "Submit refi app (DSCR)", ownerRole: "lender" },
      { key: "provide_rent_roll", name: "Provide lease + rent roll", ownerRole: "agent" },
      { key: "refi_closing", name: "Refi title / closing", ownerRole: "title" },
      { key: "payoff_acquisition", name: "Pay off acquisition loan + private lender", ownerRole: "agent" },
      { key: "receive_cashout", name: "Receive cash-out", ownerRole: "agent" },
      { key: "reconcile_capital", name: "Reconcile capital recovered vs invested", ownerRole: "agent" },
      { key: "update_capital_stack", name: "Update capital stack / notify partners", ownerRole: "agent" },
    ],
  },
  {
    key: "under_management",
    name: "Under Management",
    order: 5,
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
      { key: "execute_instruments", name: "Execute attorney-drafted instruments (note+DOT / lease+option / wrap-AITD / sub-to)", ownerRole: "agent" },
      { key: "title_insurance", name: "Title search + title insurance (confirm underlying loan/liens)", ownerRole: "title" },
      { key: "loan_servicing_setup", name: "Set up third-party loan servicing", ownerRole: "agent" },
      { key: "underlying_payment_method", name: "Establish underlying-mortgage payment method", ownerRole: "agent" },
      { key: "confirm_loan_current", name: "Confirm seller's loan current", ownerRole: "agent" },
      { key: "insurance_transfer", name: "Insurance transfer / add insured", ownerRole: "agent" },
      { key: "record_deed_note", name: "Record deed (sub-to) or note", ownerRole: "title" },
      { key: "due_on_sale_plan", name: "Due-on-sale risk plan", ownerRole: "agent" },
      { key: "scaffold_drive_chat", name: "Drive + Chat space", ownerRole: "agent", auto: true },
      { key: "upload_executed_docs", name: "Upload all executed docs", ownerRole: "agent" },
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
      { key: "pay_underlying", name: "Pay underlying mortgage ON TIME (top-severity recurring)", ownerRole: "agent" },
      { key: "collect_payment", name: "Collect tenant / buyer payment", ownerRole: "agent" },
      { key: "payment_reconciliation", name: "Monthly payment reconciliation", ownerRole: "agent" },
      { key: "monitor_loan", name: "Monitor underlying loan", ownerRole: "agent" },
      { key: "monitor_due_on_sale", name: "Monitor due-on-sale exposure", ownerRole: "agent" },
      { key: "track_balloon", name: "Track balloon / exit date (lead-time alerts)", ownerRole: "agent" },
      { key: "periodic_statements", name: "Send periodic statements", ownerRole: "agent" },
      { key: "annual_1098", name: "Annual 1098 (if lender)", ownerRole: "agent" },
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
export function humanTasks(stage: StageTemplate): TaskTemplate[] {
  return stage.tasks.filter((t) => !t.auto);
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
