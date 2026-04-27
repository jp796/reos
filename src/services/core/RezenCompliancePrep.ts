/**
 * RezenCompliancePrep
 *
 * Layer 1 of the Rezen-bridge plan. Rezen has no usable API, so we
 * stage the work the user/bot must do in the Rezen UI:
 *
 *   1. Read the transaction's Document rows + the universal/state
 *      compliance checklist.
 *   2. Match each Rezen-required slot to the best-matching REOS
 *      document (or report it as missing).
 *   3. Suggest a Rezen-friendly filename for every present doc, so
 *      uploads land in the right slot when reviewed by a human or
 *      a future Playwright bot.
 *
 * Pure function over the existing ComplianceChecklist + Document
 * rows — no Gmail call, no AI. Safe to run inside a Server Component.
 */

import type { Document } from "@prisma/client";
import {
  computeCompliance,
  requirementsFor,
  type ComplianceRequirement,
  type ComplianceStatus,
} from "./ComplianceChecklist";

/** Filename convention each compliance slot maps to in Rezen.
 * Order prefix keeps Rezen's "Documents" tab grouped logically.
 * Stable across deals so a TC's muscle memory works. */
const REZEN_FILENAME: Record<string, string> = {
  purchase_contract: "01 Purchase Contract",
  agency_disclosure: "02 Agency Disclosure",
  lead_paint_disclosure: "03 Lead-Based Paint Disclosure",
  wire_fraud_advisory: "04 Wire Fraud Advisory",
  earnest_money_receipt: "05 Earnest Money Receipt",
  inspection_report: "06 Inspection Report",
  appraisal: "07 Appraisal",
  title_commitment: "08 Title Commitment",
  settlement_statement: "09 Settlement Statement",
  broker_compliance_form: "10 Broker Compliance Form",
  sellers_property_disclosure: "11 Sellers Property Disclosure",
  // WY add-ons + buyer-side / seller-side defaults — reuses key from
  // ComplianceChecklist so any new requirement automatically gets a
  // sensible filename ("Other - <key>") if not explicitly mapped.
};

function suggestedFilename(req: ComplianceRequirement, sourceFilename: string): string {
  const base = REZEN_FILENAME[req.key] ?? `99 Other - ${req.label.slice(0, 60)}`;
  // Keep the source extension (.pdf in 99% of cases). If the source
  // is a non-PDF (e.g. .jpg), preserve so Rezen knows what type.
  const ext = sourceFilename.match(/\.[a-z0-9]+$/i)?.[0] ?? ".pdf";
  return `${base}${ext}`;
}

export interface RezenComplianceItem extends ComplianceStatus {
  /** Filename to upload as in Rezen. Null when no document matched yet. */
  rezenFilename: string | null;
  /** Slot order index (drives sort + zip filename prefix). */
  order: number;
}

export interface RezenCompliancePrepReport {
  /** All requirements (present + missing) ordered for the bundle. */
  items: RezenComplianceItem[];
  presentCount: number;
  missingCount: number;
  /** `present / total` so the UI can show a progress bar. */
  coverage: number;
}

/**
 * Build the prep report for a transaction. Caller passes already-
 * loaded Document rows + the transaction side/state so we don't do
 * Prisma I/O here (pure function = easy to unit-test).
 */
export function buildRezenPrepReport(args: {
  side: string | null;
  state: string | null;
  documents: Pick<
    Document,
    "id" | "fileName" | "category" | "extractedText" | "source"
  >[];
}): RezenCompliancePrepReport {
  const reqs = requirementsFor({ side: args.side, state: args.state });
  const coverage = computeCompliance(reqs, args.documents);

  const items: RezenComplianceItem[] = coverage.map((c, i) => {
    const firstMatch = c.matches[0];
    return {
      ...c,
      rezenFilename: firstMatch
        ? suggestedFilename(c.requirement, firstMatch.fileName)
        : null,
      order: i,
    };
  });

  // Sort by REZEN_FILENAME numeric prefix for present items, missing
  // items keep their original order at the bottom.
  items.sort((a, b) => {
    const ap = REZEN_FILENAME[a.requirement.key] ?? "99";
    const bp = REZEN_FILENAME[b.requirement.key] ?? "99";
    if (a.status === b.status) return ap.localeCompare(bp);
    // present first, missing after
    return a.status === "present" ? -1 : 1;
  });

  const presentCount = items.filter((i) => i.status === "present").length;
  return {
    items,
    presentCount,
    missingCount: items.length - presentCount,
    coverage: items.length === 0 ? 0 : presentCount / items.length,
  };
}
