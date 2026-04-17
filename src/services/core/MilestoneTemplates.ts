/**
 * MilestoneTemplates
 *
 * Lean templates (5-7 items per transaction type). These are the big rocks
 * you want to see at a glance. Refine later if needed — stored in code for
 * now; can migrate to DB-configurable per-account later.
 *
 * `offsetDays` is relative to the transaction's `contractDate`.
 *   < 0 = before contract (e.g. listing agreement signed)
 *   > 0 = after contract (inspection, appraisal, financing, closing)
 */

import type {
  MilestoneType,
  MilestoneOwnerRole,
  TransactionType,
} from "@/types";

export interface MilestoneTemplate {
  type: MilestoneType;
  label: string;
  ownerRole: MilestoneOwnerRole;
  offsetDays: number;
}

const BUYER: MilestoneTemplate[] = [
  { type: "buyer_agreement_signed", label: "Buyer agreement signed", ownerRole: "agent", offsetDays: -7 },
  { type: "under_contract", label: "Under contract", ownerRole: "agent", offsetDays: 0 },
  { type: "earnest_money_due", label: "Earnest money due", ownerRole: "client", offsetDays: 3 },
  { type: "inspections_scheduled", label: "Inspections scheduled", ownerRole: "inspector", offsetDays: 7 },
  { type: "appraisal_ordered", label: "Appraisal ordered", ownerRole: "lender", offsetDays: 10 },
  { type: "financing_approved", label: "Financing approved", ownerRole: "lender", offsetDays: 21 },
  { type: "closing", label: "Closing", ownerRole: "title", offsetDays: 30 },
];

const SELLER: MilestoneTemplate[] = [
  { type: "listing_agreement_signed", label: "Listing agreement signed", ownerRole: "agent", offsetDays: -14 },
  { type: "property_live", label: "Property live on MLS", ownerRole: "agent", offsetDays: -10 },
  { type: "offer_received", label: "Offer received", ownerRole: "agent", offsetDays: 0 },
  { type: "under_contract", label: "Under contract", ownerRole: "agent", offsetDays: 0 },
  { type: "inspection_response", label: "Inspection response window", ownerRole: "agent", offsetDays: 10 },
  { type: "appraisal_completed", label: "Appraisal completed", ownerRole: "lender", offsetDays: 14 },
  { type: "closing", label: "Closing", ownerRole: "title", offsetDays: 30 },
];

const INVESTOR: MilestoneTemplate[] = [
  { type: "under_contract", label: "Contract executed", ownerRole: "agent", offsetDays: 0 },
  { type: "earnest_money_due", label: "Earnest money due", ownerRole: "client", offsetDays: 3 },
  { type: "inspections_scheduled", label: "Due diligence period", ownerRole: "inspector", offsetDays: 7 },
  { type: "title_commitment_received", label: "Title work complete", ownerRole: "title", offsetDays: 14 },
  { type: "closing", label: "Closing", ownerRole: "title", offsetDays: 21 },
];

const WHOLESALE: MilestoneTemplate[] = [
  { type: "under_contract", label: "Contract executed", ownerRole: "agent", offsetDays: 0 },
  { type: "earnest_money_due", label: "Earnest money due", ownerRole: "client", offsetDays: 3 },
  { type: "title_commitment_received", label: "Title/assignment prep", ownerRole: "title", offsetDays: 10 },
  { type: "closing", label: "Closing / assignment", ownerRole: "title", offsetDays: 21 },
];

const OTHER: MilestoneTemplate[] = [
  { type: "under_contract", label: "Agreement signed", ownerRole: "agent", offsetDays: 0 },
  { type: "closing", label: "Closing", ownerRole: "title", offsetDays: 30 },
];

export const MILESTONE_TEMPLATES: Record<TransactionType, MilestoneTemplate[]> = {
  buyer: BUYER,
  seller: SELLER,
  investor: INVESTOR,
  wholesale: WHOLESALE,
  other: OTHER,
};

/**
 * Compute a milestone's dueAt given a transaction's contract date.
 * Falls back to "today" if no contract date is set yet.
 */
export function computeDueAt(
  template: MilestoneTemplate,
  contractDate: Date | null | undefined,
): Date {
  const base = contractDate ?? new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + template.offsetDays);
  return d;
}
