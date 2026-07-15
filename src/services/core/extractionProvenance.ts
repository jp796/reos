/**
 * extractionProvenance — pull a compact, persistable provenance map from a
 * contract extraction: per date field, the source snippet + model confidence.
 * Stored on Transaction.datesProvenanceJson so Atlas Trace can show a
 * "where did this come from" badge on the timeline long after the transient
 * pendingContractJson is cleared.
 */

/** The date fields we surface on the timeline. */
const DATE_FIELDS = [
  "effectiveDate",
  "closingDate",
  "possessionDate",
  "inspectionDeadline",
  "inspectionObjectionDeadline",
  "titleObjectionDeadline",
  "titleCommitmentDeadline",
  "financingDeadline",
  "walkthroughDate",
  "earnestMoneyDueDate",
] as const;

export interface DateProvenance {
  snippet: string | null;
  confidence: number | null;
  source: "text" | "vision" | "computed";
  page: number | null;
}

/** Build { fieldKey: {snippet, confidence, source} } from a ContractExtraction
 *  (fields shaped {value, confidence, snippet}). Only includes fields that
 *  actually carry a snippet or confidence. Returns null when nothing usable. */
export function buildDatesProvenance(
  extraction: unknown,
): Record<string, DateProvenance> | null {
  if (!extraction || typeof extraction !== "object") return null;
  const ex = extraction as Record<string, unknown>;
  const out: Record<string, DateProvenance> = {};
  for (const key of DATE_FIELDS) {
    const f = ex[key];
    if (!f || typeof f !== "object") continue;
    const rec = f as { snippet?: unknown; confidence?: unknown; source?: unknown; page?: unknown };
    const snippet = typeof rec.snippet === "string" && rec.snippet.trim() ? rec.snippet : null;
    const confidence = typeof rec.confidence === "number" ? rec.confidence : null;
    if (!snippet && confidence == null) continue;
    const source =
      rec.source === "vision" || rec.source === "computed" || rec.source === "text"
        ? (rec.source as "text" | "vision" | "computed")
        : "text";
    const page = typeof rec.page === "number" && rec.page >= 1 ? Math.round(rec.page) : null;
    out[key] = { snippet, confidence, source, page };
  }
  return Object.keys(out).length > 0 ? out : null;
}
