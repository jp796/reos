/**
 * RezenCompliancePrep
 *
 * Layer 1 of the Rezen-bridge plan. Rezen has two checklists per
 * transaction in their UI — Transaction (buy/dual, 34 items) and
 * Listing (seller, 14 items). This module mirrors those item lists
 * 1:1 so REOS can:
 *
 *   - Tell the user (or future Playwright bot) exactly which slot
 *     each REOS Document maps to.
 *   - Surface "missing required" gaps before the file is submitted.
 *   - Rename PDFs in the downloadable bundle to match Rezen labels
 *     (drop the zip into Rezen's file UI and slots line up).
 *
 * The slot lists below are source-of-truth, mirrored from Real
 * Broker's actual Rezen checklists (screenshot 2026-04-27). When
 * Rezen adds/renames items, edit here.
 */

import type { Document } from "@prisma/client";

export type RezenChecklistKind = "transaction" | "listing";
export type RezenRequiredness = "required" | "if_applicable";

export interface RezenSlot {
  /** Position in Rezen's UI (drives sort + filename prefix). */
  number: number;
  /** Stable id for cross-version diffs. */
  key: string;
  /** Exact label as it appears in Rezen's UI. */
  label: string;
  required: RezenRequiredness;
  /** Optional Rezen tag — drives the small chip on the slot row. */
  tag?: "cda" | "closing_docs" | "termination";
  /** Optional sub-text — Rezen shows in the "Required For" column. */
  requiredFor?: string;
  /** Lowercase keyword fragments. Matched (OR) against REOS
   * Document.fileName + category + extractedText. */
  keywords: string[];
}

/* ============================================================
 * TRANSACTION CHECKLIST (buy / dual)
 * 34 items, mirrored from Rezen UI.
 * ============================================================ */
export const TRANSACTION_SLOTS: RezenSlot[] = [
  {
    number: 1,
    key: "accepted_contract_counters",
    label: "Accepted Contract/Counters",
    required: "required",
    tag: "cda",
    requiredFor: "Commission Doc Generation",
    keywords: [
      "accepted contract",
      "purchase contract",
      "purchase agreement",
      "executed contract",
      "counter",
      "psa",
      "rpa",
      "contract to buy",
    ],
  },
  {
    number: 2,
    key: "real_consumer_choice_referral_disclosure",
    label: "Real Consumer Choice And Referral Fee Disclosure",
    required: "if_applicable",
    keywords: ["consumer choice", "referral fee disclosure", "real referral"],
  },
  {
    number: 3,
    key: "broker_disclosure_seller",
    label: "Broker Disclosure - Seller",
    required: "required",
    tag: "cda",
    requiredFor: "Commission Doc Generation",
    keywords: ["broker disclosure", "brokerage disclosure", "seller agency"],
  },
  {
    number: 4,
    key: "broker_disclosure_buyer",
    label: "Broker Disclosure - Buyer",
    required: "required",
    keywords: ["broker disclosure - buyer", "buyer agency", "agency disclosure"],
  },
  {
    number: 5,
    key: "bill_of_sale",
    label: "Bill Of Sale",
    required: "required",
    keywords: ["bill of sale"],
  },
  {
    number: 6,
    key: "lead_based_paint_disclosure",
    label: "Lead-Based Paint Disclosure (Required If Built Before 1978)",
    required: "if_applicable",
    keywords: ["lead-based paint", "lead based paint", "lbp"],
  },
  {
    number: 7,
    key: "sellers_property_disclosure",
    label: "Sellers Property Disclosure",
    required: "if_applicable",
    keywords: ["seller's property disclosure", "sellers property disclosure", "spd"],
  },
  {
    number: 8,
    key: "pre_qualification_letter",
    label: "Pre-Qualification Letter",
    required: "required",
    keywords: ["pre-qualification", "prequalification", "preapproval", "pre-approval"],
  },
  {
    number: 9,
    key: "earnest_money_receipt",
    label: "Earnest Money Receipt",
    required: "required",
    keywords: ["earnest money receipt", "em receipt", "earnest money", "deposit receipt"],
  },
  {
    number: 10,
    key: "copy_of_title_commitment",
    label: "Copy Of Title Commitment",
    required: "required",
    keywords: ["title commitment", "preliminary title", "prelim title"],
  },
  {
    number: 11,
    key: "acknowledgement_of_title",
    label: "Acknowledgement Of Title",
    required: "if_applicable",
    keywords: ["acknowledgement of title", "title acknowledgement"],
  },
  {
    number: 12,
    key: "acknowledgement_of_covenants",
    label: "Acknowledgement Of Covenants",
    required: "if_applicable",
    keywords: ["covenants", "ccrs", "cc&rs"],
  },
  {
    number: 13,
    key: "notice_of_inspection",
    label: "Notice Of Inspection",
    required: "required",
    keywords: ["notice of inspection"],
  },
  {
    number: 14,
    key: "copy_of_inspections",
    label: "Copy Of Inspections",
    required: "required",
    keywords: ["inspection report", "home inspection", "inspections"],
  },
  {
    number: 15,
    key: "inspection_contingency_notice",
    label: "Inspection Contingency Notice",
    required: "required",
    keywords: ["inspection contingency", "inspection objection"],
  },
  {
    number: 16,
    key: "roof_certification",
    label: "Roof Certification",
    required: "if_applicable",
    keywords: ["roof certification", "roof cert"],
  },
  {
    number: 17,
    key: "buyer_waives_inspection_form",
    label: "Buyer Waives Inspection Form",
    required: "if_applicable",
    keywords: ["waives inspection", "waive inspection", "inspection waiver"],
  },
  {
    number: 18,
    key: "buyers_final_walk_through",
    label: "Buyers Final Walk Through",
    required: "if_applicable",
    keywords: ["final walk through", "final walkthrough", "walkthrough"],
  },
  {
    number: 19,
    key: "consent_amendment_in_company_transaction",
    label: "Consent Amendment In Company Transaction",
    required: "if_applicable",
    keywords: ["consent amendment", "in-company transaction"],
  },
  {
    number: 20,
    key: "designation_of_agent",
    label: "Designation Of Agent (In-House Transactions Required)",
    required: "if_applicable",
    keywords: ["designation of agent", "designated agent"],
  },
  {
    number: 21,
    key: "amend_extend_addendum",
    label: "Amend/Extend/Addendum",
    required: "if_applicable",
    keywords: ["amend", "extend", "addendum"],
  },
  {
    number: 22,
    key: "pre_occupancy_agreement",
    label: "Pre-Occupancy Agreement",
    required: "if_applicable",
    keywords: ["pre-occupancy", "pre occupancy"],
  },
  {
    number: 23,
    key: "seventy_two_hour_contingency_exhibit_1",
    label: "72 Hour Contingency Exhibit 1",
    required: "if_applicable",
    keywords: ["72 hour", "72-hour contingency", "exhibit 1"],
  },
  {
    number: 24,
    key: "miscellaneous_paperwork",
    label: "Miscellaneous Paperwork",
    required: "if_applicable",
    keywords: ["miscellaneous", "misc paperwork"],
  },
  {
    number: 25,
    key: "referral_agreement",
    label: "Referral Agreement",
    required: "if_applicable",
    keywords: ["referral agreement", "referral contract"],
  },
  {
    number: 26,
    key: "home_warranty",
    label: "Home Warranty",
    required: "if_applicable",
    keywords: ["home warranty", "warranty"],
  },
  {
    number: 27,
    key: "property_unseen_hold_harmless",
    label: "Property Unseen Hold Harmless",
    required: "if_applicable",
    keywords: ["property unseen", "hold harmless"],
  },
  {
    number: 28,
    key: "buyers_estimated_costs",
    label: "Buyers Estimated Costs",
    required: "if_applicable",
    keywords: ["buyer's estimated", "buyers estimated", "estimated costs"],
  },
  {
    number: 29,
    key: "affiliated_business_arrangement_disclosure",
    label: "Affiliated Business Arrangement Disclosure",
    required: "if_applicable",
    keywords: ["affiliated business", "aba"],
  },
  {
    number: 30,
    key: "final_signed_settlement_statement",
    label: "Final Signed Settlement Statement (With Real Listed As A Line Item)",
    required: "required",
    tag: "closing_docs",
    requiredFor: "Closing",
    keywords: [
      "settlement statement",
      "closing disclosure",
      "alta",
      "hud-1",
      "hud1",
      "final ss",
    ],
  },
  {
    number: 31,
    key: "proof_of_payment_real",
    label: "Proof Of Payment - Real (Wire Confirmation Or Deposit Receipt)",
    required: "required",
    tag: "closing_docs",
    requiredFor: "Closing",
    keywords: ["wire confirmation", "deposit receipt", "proof of payment"],
  },
  {
    number: 32,
    key: "termination_of_contract",
    label: "Termination Of Contract",
    required: "if_applicable",
    tag: "termination",
    keywords: ["termination of contract", "contract termination"],
  },
  {
    number: 33,
    key: "termination_paperwork",
    label: "Termination Paperwork",
    required: "if_applicable",
    keywords: ["termination paperwork"],
  },
  {
    number: 34,
    key: "referral_agreement_real_referral_disclosure",
    label: "Referral Agreement & Real Referral Disclosure",
    required: "if_applicable",
    keywords: ["real referral disclosure"],
  },
];

/* ============================================================
 * LISTING CHECKLIST (seller-side)
 * 14 items, mirrored from Rezen UI.
 * ============================================================ */
export const LISTING_SLOTS: RezenSlot[] = [
  {
    number: 1,
    key: "listing_agreement",
    label: "Listing Agreement",
    required: "required",
    tag: "cda",
    requiredFor: "Commission Doc Generation",
    keywords: ["listing agreement", "exclusive right to sell"],
  },
  {
    number: 2,
    key: "real_consumer_choice_referral_disclosure",
    label: "Real Consumer Choice And Referral Fee Disclosure",
    required: "required",
    keywords: ["consumer choice", "referral fee disclosure"],
  },
  {
    number: 3,
    key: "brokerage_disclosure",
    label: "Brokerage Disclosure",
    required: "required",
    tag: "cda",
    requiredFor: "Commission Doc Generation",
    keywords: ["brokerage disclosure"],
  },
  {
    number: 4,
    key: "lead_based_paint_disclosure",
    label: "Lead-Based Paint Disclosure (Required If Built Before 1978)",
    required: "if_applicable",
    keywords: ["lead-based paint", "lead based paint", "lbp"],
  },
  {
    number: 5,
    key: "sellers_property_disclosure",
    label: "Sellers Property Disclosure",
    required: "if_applicable",
    tag: "cda",
    keywords: ["seller's property disclosure", "sellers property disclosure", "spd"],
  },
  {
    number: 6,
    key: "mls_listing",
    label: "MLS Listing",
    required: "required",
    tag: "cda",
    requiredFor: "Commission Doc Generation",
    keywords: ["mls listing", "mls sheet", "mls printout"],
  },
  {
    number: 7,
    key: "estimated_net_to_seller_sheet",
    label: "Estimated Net To Seller Sheet",
    required: "required",
    keywords: ["estimated net to seller", "net sheet", "seller net"],
  },
  {
    number: 8,
    key: "addendums_disclosure",
    label: "Addendums/Disclosure",
    required: "if_applicable",
    keywords: ["addendum", "addendums"],
  },
  {
    number: 9,
    key: "miscellaneous_paperwork",
    label: "Miscellaneous Paperwork",
    required: "if_applicable",
    keywords: ["miscellaneous", "misc paperwork"],
  },
  {
    number: 10,
    key: "email_text_communication",
    label: "Email/Text Communication",
    required: "if_applicable",
    keywords: ["email communication", "text communication"],
  },
  {
    number: 11,
    key: "wire_fraud_advisory",
    label: "Wire Fraud Advisory",
    required: "required",
    tag: "cda",
    requiredFor: "Commission Doc Generation",
    keywords: ["wire fraud", "wire advisory", "fraud warning"],
  },
  {
    number: 12,
    key: "explanation_of_contract_to_client",
    label: "Explanation Of Contract To Client",
    required: "required",
    tag: "cda",
    requiredFor: "Commission Doc Generation",
    keywords: ["explanation of contract"],
  },
  {
    number: 13,
    key: "termination_of_contract",
    label: "Termination Of Contract",
    required: "if_applicable",
    tag: "termination",
    keywords: ["termination of contract", "contract termination"],
  },
  {
    number: 14,
    key: "offers_not_accepted",
    label: "Offers Not Accepted",
    required: "if_applicable",
    keywords: ["offers not accepted", "rejected offer"],
  },
];

/** Pick which checklist applies to a transaction. Dual-agency
 * defaults to BOTH — caller can request just one via opts. */
export function checklistKindFor(side: string | null): RezenChecklistKind {
  if (side === "sell") return "listing";
  return "transaction";
}

/**
 * Load slots for a brokerage profile + kind from the
 * BrokerageChecklist table. Falls back to the hard-coded
 * Real-Broker / Rezen lists when profileId is null OR no rows
 * exist. Keeps things backward-compatible while we migrate.
 */
export async function loadSlotsForProfile(
  db: import("@prisma/client").PrismaClient,
  profileId: string | null,
  kind: RezenChecklistKind,
  stateCode: string | null = null,
): Promise<RezenSlot[]> {
  if (!profileId) {
    return kind === "listing" ? LISTING_SLOTS : TRANSACTION_SLOTS;
  }
  const rows = await db.brokerageChecklist.findMany({
    where: {
      profileId,
      kind,
      OR: [{ stateCode: null }, ...(stateCode ? [{ stateCode }] : [])],
    },
    orderBy: { slotNumber: "asc" },
  });
  if (rows.length === 0) {
    return kind === "listing" ? LISTING_SLOTS : TRANSACTION_SLOTS;
  }
  return rows.map((r) => ({
    number: r.slotNumber,
    key: r.slotKey,
    label: r.label,
    required: r.required as RezenRequiredness,
    tag:
      (r.tag as "cda" | "closing_docs" | "termination" | undefined) ?? undefined,
    requiredFor: r.requiredFor ?? undefined,
    keywords: Array.isArray(r.keywordsJson)
      ? (r.keywordsJson as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [],
  }));
}

/** Pad single-digit slot numbers so filenames sort lexically. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Sanitize Rezen label → safe filename component. Preserves the
 * "01 - " prefix so files line up with the slot order in Rezen. */
function rezenFilenameFor(slot: RezenSlot, sourceFilename: string): string {
  const ext = sourceFilename.match(/\.[a-z0-9]+$/i)?.[0] ?? ".pdf";
  // Trim parenthetical clarifiers — Rezen labels can be 80+ chars
  // and OS file dialogs choke on that.
  const labelClean = slot.label
    .replace(/\([^)]*\)/g, "")
    .replace(/[^A-Za-z0-9 \-&]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 70);
  return `${pad2(slot.number)} - ${labelClean}${ext}`;
}

export interface RezenSlotStatus {
  slot: RezenSlot;
  status: "present" | "missing";
  matches: Array<{ id: string; fileName: string; source: string }>;
  rezenFilename: string | null;
}

export interface RezenCompliancePrepReport {
  kind: RezenChecklistKind;
  items: RezenSlotStatus[];
  /** "Required" slots that are still missing. The user gates on this. */
  requiredMissing: number;
  presentCount: number;
  totalCount: number;
  /** present / total, capped at 1. */
  coverage: number;
}

/**
 * Build the per-side prep report. Caller passes already-loaded
 * Document rows so this stays a pure function.
 *
 * Match order per slot:
 *   1. AI classification (Document.suggestedRezenSlot === slot.key)
 *      with confidence >= 0.5
 *   2. Filename / category / extractedText keyword regex
 * Anything matched by AI is shown first so confident classifications
 * trump filename heuristics.
 */
export function buildRezenPrepReport(args: {
  side: string | null;
  documents: Pick<
    Document,
    | "id"
    | "fileName"
    | "category"
    | "extractedText"
    | "source"
    | "suggestedRezenSlot"
    | "suggestedRezenConfidence"
  >[];
  /** Slot list to use. When omitted, falls back to the hard-coded
   * Real-Broker lists — backward compat for callers that haven't
   * migrated to BrokerageChecklist DB rows yet. */
  slots?: RezenSlot[];
  /** Override the auto-picked checklist (e.g. show both on dual). */
  kind?: RezenChecklistKind;
}): RezenCompliancePrepReport {
  const kind = args.kind ?? checklistKindFor(args.side);
  const slots =
    args.slots ?? (kind === "listing" ? LISTING_SLOTS : TRANSACTION_SLOTS);

  const items: RezenSlotStatus[] = slots.map((slot) => {
    const re = new RegExp(
      slot.keywords
        .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|"),
      "i",
    );

    const aiMatches = args.documents.filter(
      (d) =>
        d.suggestedRezenSlot === slot.key &&
        (d.suggestedRezenConfidence ?? 0) >= 0.5,
    );
    const keywordMatches = args.documents.filter((d) => {
      // Skip if already picked up by AI to avoid double-listing
      if (aiMatches.some((m) => m.id === d.id)) return false;
      const blob = [d.fileName, d.category ?? "", d.extractedText ?? ""].join(" ");
      return re.test(blob);
    });

    const allMatches = [...aiMatches, ...keywordMatches];
    const firstMatch = allMatches[0];
    return {
      slot,
      status: allMatches.length > 0 ? "present" : "missing",
      matches: allMatches.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        source: d.source,
      })),
      rezenFilename: firstMatch
        ? rezenFilenameFor(slot, firstMatch.fileName)
        : null,
    };
  });

  // Sort: present first (so the user sees what's done), required-
  // missing next (the action list), if-applicable last.
  items.sort((a, b) => {
    const rank = (x: RezenSlotStatus): number => {
      if (x.status === "present") return 0;
      if (x.slot.required === "required") return 1;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.slot.number - b.slot.number;
  });

  const presentCount = items.filter((i) => i.status === "present").length;
  const requiredMissing = items.filter(
    (i) => i.status === "missing" && i.slot.required === "required",
  ).length;

  return {
    kind,
    items,
    requiredMissing,
    presentCount,
    totalCount: items.length,
    coverage: items.length === 0 ? 0 : presentCount / items.length,
  };
}
