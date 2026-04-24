/**
 * ComplianceChecklist
 *
 * Per-state, per-side required documents for a real-estate transaction.
 * Real Broker (and every brokerage) has a standard file audit — a TC
 * reconciles what docs are on hand vs what's required before submitting
 * the closed file.
 *
 * This module encodes the requirement set and provides a function that
 * takes a transaction + its Document rows and returns a coverage
 * report: which items are present, which are missing, which might be
 * matched (fuzzy filename).
 *
 * The matcher is deliberately permissive. It looks for keyword hits
 * in Document.fileName, Document.category, and Document.extractedText
 * (if present). A single doc can satisfy multiple items (e.g. an ALTA
 * statement counts as both "Closing Disclosure" AND "Settlement
 * Statement" in some states). We let it match greedily — avoid false
 * negatives, it's just a reminder.
 */

import type { Document } from "@prisma/client";

export interface ComplianceRequirement {
  /** Stable id for state/side carryover. */
  key: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Longer explanation — when in doubt, show this. */
  detail?: string;
  /** Keywords that satisfy the requirement. Case-insensitive OR match
   * against filename + category + extractedText. */
  keywords: string[];
  /** Which transaction side(s) this applies to. undefined = both. */
  sides?: Array<"buy" | "sell" | "both">;
  /** Contract stage this must be in-place by. For now just informational
   * ("before-contract" / "under-contract" / "before-close"). */
  stage?: "before_contract" | "under_contract" | "before_close" | "post_close";
  /** Federal law / state statute backing this. Optional — shown on hover. */
  authority?: string;
}

/** Rules that apply to every residential purchase regardless of state. */
const UNIVERSAL: ComplianceRequirement[] = [
  {
    key: "purchase_contract",
    label: "Executed purchase contract",
    detail: "Fully-signed purchase agreement with all amendments / addenda.",
    keywords: ["contract", "purchase agreement", "psa", "cbs", "rpa"],
    stage: "under_contract",
  },
  {
    key: "agency_disclosure",
    label: "Agency disclosure",
    detail:
      "Disclosure of who represents whom. Required in nearly every state before substantive negotiation.",
    keywords: ["agency", "disclosure of brokerage", "relationship disclosure"],
    stage: "before_contract",
  },
  {
    key: "lead_paint_disclosure",
    label: "Lead-based paint disclosure (pre-1978 homes)",
    detail:
      "Federal law requires for any home built before 1978. EPA pamphlet + signed disclosure.",
    keywords: ["lead", "lead-based", "lead paint", "lbp"],
    stage: "before_contract",
    authority: "Residential Lead-Based Paint Hazard Reduction Act, 42 U.S.C. § 4852d",
  },
  {
    key: "wire_fraud_advisory",
    label: "Wire fraud advisory",
    detail:
      "Warns parties about wire fraud — increasingly required by brokerages for CYA.",
    keywords: ["wire fraud", "wire advisory", "fraud warning"],
    stage: "under_contract",
  },
  {
    key: "earnest_money_receipt",
    label: "Earnest money receipt",
    detail:
      "Confirms title co received EM. Usually a title-co generated PDF or email.",
    keywords: ["earnest money", "em receipt", "escrow receipt", "deposit receipt"],
    stage: "under_contract",
  },
  {
    key: "inspection_report",
    label: "Inspection report",
    detail:
      "Home inspection results. Optional if inspection waived in contract.",
    keywords: ["inspection report", "home inspection"],
    stage: "under_contract",
  },
  {
    key: "appraisal",
    label: "Appraisal report (if financed)",
    detail: "Appraisal from lender. N/A on cash deals.",
    keywords: ["appraisal"],
    stage: "before_close",
    sides: ["buy", "both"],
  },
  {
    key: "title_commitment",
    label: "Title commitment",
    detail: "Prelim title work from title co, listing exceptions.",
    keywords: ["title commitment", "prelim title", "preliminary title"],
    stage: "under_contract",
  },
  {
    key: "settlement_statement",
    label: "Settlement statement / Closing Disclosure",
    detail:
      "Final settlement figures. Called ALTA / HUD-1 / CD depending on loan type + year.",
    keywords: [
      "settlement statement",
      "closing disclosure",
      "alta",
      "hud-1",
      "hud1",
      "ss",
      "final ss",
    ],
    stage: "before_close",
  },
  {
    key: "broker_compliance_form",
    label: "Broker compliance / file submission form",
    detail:
      "Real Broker requires a file-complete signoff before releasing commission.",
    keywords: ["compliance", "file submission", "transaction summary"],
    stage: "post_close",
  },
];

/** Seller-side specific requirements. */
const SELLER_ONLY: ComplianceRequirement[] = [
  {
    key: "sellers_property_disclosure",
    label: "Seller's property disclosure",
    detail:
      "Required in most states. Seller attests to known defects / history.",
    keywords: [
      "seller's disclosure",
      "sellers disclosure",
      "property disclosure",
      "spd",
    ],
    stage: "before_contract",
    sides: ["sell", "both"],
  },
  {
    key: "listing_agreement",
    label: "Listing agreement",
    detail: "Exclusive right-to-sell contract between seller + brokerage.",
    keywords: ["listing agreement", "exclusive right to sell", "ers"],
    stage: "before_contract",
    sides: ["sell", "both"],
  },
  {
    key: "mls_printout",
    label: "MLS printout",
    detail: "Final MLS record at time of sale.",
    keywords: ["mls", "listing report"],
    stage: "post_close",
    sides: ["sell", "both"],
  },
];

/** Buyer-side specific requirements. */
const BUYER_ONLY: ComplianceRequirement[] = [
  {
    key: "buyer_agency_agreement",
    label: "Buyer agency / representation agreement",
    detail: "Contract between buyer + brokerage establishing representation.",
    keywords: [
      "buyer agency",
      "buyer representation",
      "buyer's broker",
      "bba",
    ],
    stage: "before_contract",
    sides: ["buy", "both"],
  },
  {
    key: "pre_approval",
    label: "Lender pre-approval letter",
    detail: "Pre-qual or pre-approval from lender. N/A on cash deals.",
    keywords: ["pre-approval", "preapproval", "pre-qual", "prequal"],
    stage: "before_contract",
    sides: ["buy", "both"],
  },
  {
    key: "loan_estimate",
    label: "Loan estimate (if financed)",
    detail: "LE from lender, TILA-required within 3 days of application.",
    keywords: ["loan estimate", "le"],
    stage: "under_contract",
    sides: ["buy", "both"],
  },
];

/** Wyoming-specific add-ons. Extend as we learn other states. */
const WY_ADDONS: ComplianceRequirement[] = [
  {
    key: "wy_agency_pamphlet",
    label: "WY real-estate brokerage relationships pamphlet",
    detail: "WY requires disclosure of rep relationships before substantive discussion.",
    keywords: ["brokerage relationships", "real estate pamphlet", "wy pamphlet"],
    stage: "before_contract",
  },
];

export function requirementsFor(params: {
  side: string | null;
  state: string | null;
}): ComplianceRequirement[] {
  const side = params.side;
  const state = (params.state ?? "").toUpperCase();
  const out = [...UNIVERSAL];

  // Side-specific
  if (side === "sell" || side === "both") out.push(...SELLER_ONLY);
  if (side === "buy" || side === "both") out.push(...BUYER_ONLY);

  // State-specific
  if (state === "WY") out.push(...WY_ADDONS);

  // Final filter: only include rules whose `sides` array allows the
  // current side (or that specify no side filter)
  return out.filter((r) => {
    if (!r.sides || r.sides.length === 0) return true;
    if (!side) return true; // no side set, show all
    return r.sides.includes(side as "buy" | "sell" | "both");
  });
}

export interface ComplianceStatus {
  requirement: ComplianceRequirement;
  /** "present" = at least one doc matched, "missing" = none. */
  status: "present" | "missing";
  /** Which document(s) matched. Empty when status=missing. */
  matches: Array<{ id: string; fileName: string; source: string }>;
}

/** Compute coverage for a set of requirements against a document set. */
export function computeCompliance(
  requirements: ComplianceRequirement[],
  documents: Pick<Document, "id" | "fileName" | "category" | "extractedText" | "source">[],
): ComplianceStatus[] {
  return requirements.map((r) => {
    const re = new RegExp(
      r.keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
      "i",
    );
    const matches = documents.filter((d) => {
      const blob = [d.fileName, d.category ?? "", d.extractedText ?? ""].join(
        " ",
      );
      return re.test(blob);
    });
    return {
      requirement: r,
      status: matches.length > 0 ? "present" : "missing",
      matches: matches.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        source: d.source,
      })),
    };
  });
}

/** One-shot: load docs, compute coverage, return it. */
export async function auditTransactionCompliance(
  db: import("@prisma/client").PrismaClient,
  transactionId: string,
): Promise<{
  missing: number;
  present: number;
  total: number;
  items: ComplianceStatus[];
}> {
  const txn = await db.transaction.findUnique({
    where: { id: transactionId },
    select: { side: true, state: true },
  });
  if (!txn) {
    return { missing: 0, present: 0, total: 0, items: [] };
  }
  const docs = await db.document.findMany({
    where: { transactionId },
    select: {
      id: true,
      fileName: true,
      category: true,
      extractedText: true,
      source: true,
    },
  });
  const reqs = requirementsFor({ side: txn.side, state: txn.state });
  const items = computeCompliance(reqs, docs);
  const present = items.filter((i) => i.status === "present").length;
  const missing = items.length - present;
  return { items, present, missing, total: items.length };
}
