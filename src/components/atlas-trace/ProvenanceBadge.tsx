"use client";

/**
 * Atlas Trace — production provenance primitives (§1 rollout).
 *
 * Ambient provenance: a persistent, clickable "where did this come from" badge
 * on extracted fields — the source clause + model confidence, read from the
 * stored contract extraction. Ported from the approved prototype
 * (`prototypes/atlas-trace/components/primitives.tsx`); page is optional here
 * because the extraction doesn't yet carry a page number (handoff gap #1).
 */

import { useState } from "react";

/** The field-level provenance the badge renders, from a ContractExtractionField. */
export interface FieldProvenance {
  snippet: string | null;
  confidence: number | null;
  source?: "text" | "vision" | "computed";
  page?: number | null;
}

export function ConfidenceMarker({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const low = confidence < 0.7;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] tabular-nums ${low ? "text-amber-700 dark:text-amber-400" : "text-text-subtle"}`}
      title={`Atlas confidence ${pct}%`}
    >
      <span className="inline-flex h-1 w-6 overflow-hidden rounded-full bg-border">
        <span className={`h-full ${low ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}

/**
 * Provenance badge — persistent, clickable source reference. Click reveals the
 * exact clause Atlas read. Renders nothing when there's no snippet to show.
 */
export function ProvenanceBadge({ prov }: { prov: FieldProvenance }) {
  const [open, setOpen] = useState(false);
  const snippet = prov.snippet?.trim();
  // Nothing worth showing: no source clause AND no real confidence (0 = the
  // model didn't actually anchor this field — a "0%" marker would mislead).
  if (!snippet && !prov.confidence) return null;
  const source = prov.source ?? "text";
  const label = prov.page != null ? `Page ${prov.page}` : "Source";

  return (
    <span className="relative inline-flex items-center gap-1.5 align-middle">
      {snippet && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted transition-colors hover:border-brand-300 hover:text-brand-700"
          title="View the source clause Atlas read"
        >
          <span className="h-1 w-1 rounded-full bg-brand-500/70" />
          {label}
        </button>
      )}
      {prov.confidence != null && <ConfidenceMarker confidence={prov.confidence} />}
      {source === "computed" && (
        <span className="text-[10px] text-text-subtle" title="Computed from a relative-date rule in the contract">
          derived
        </span>
      )}
      {open && snippet && (
        <span className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-surface p-2 text-[11px] italic leading-relaxed text-text shadow-md">
          &ldquo;{snippet}&rdquo;
          <span className="mt-1 block not-italic text-[10px] text-text-subtle">
            {source === "text"
              ? "Read from the document text"
              : source === "vision"
                ? "Read from the page image"
                : "Computed from a relative-date rule"}
            {prov.page != null ? ` · page ${prov.page}` : ""}
          </span>
        </span>
      )}
    </span>
  );
}

/** Extraction field key for a milestone, by keyword on its type + label.
 *  Order matters — more specific ("inspection objection") before generic. */
export function extractionFieldForMilestone(type: string, label: string): string | null {
  const s = `${type} ${label}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/inspection[_\s]*objection/, "inspectionObjectionDeadline"],
    [/title[_\s]*objection/, "titleObjectionDeadline"],
    [/title[_\s]*(commitment|work)/, "titleCommitmentDeadline"],
    [/inspection/, "inspectionDeadline"],
    [/financ/, "financingDeadline"],
    [/earnest/, "earnestMoneyDueDate"],
    [/possession/, "possessionDate"],
    [/walkthrough|walk[_\s]*through/, "walkthroughDate"],
    [/clos/, "closingDate"],
    [/effective|under[_\s]*contract|contract[_\s]*execut/, "effectiveDate"],
  ];
  for (const [re, key] of rules) if (re.test(s)) return key;
  return null;
}

/** Pull {snippet, confidence} for a field from a stored ContractExtraction. */
export function provenanceFromExtraction(
  extraction: unknown,
  fieldKey: string,
): FieldProvenance | null {
  if (!extraction || typeof extraction !== "object") return null;
  const f = (extraction as Record<string, unknown>)[fieldKey];
  if (!f || typeof f !== "object") return null;
  const rec = f as { snippet?: unknown; confidence?: unknown; source?: unknown; page?: unknown };
  const snippet = typeof rec.snippet === "string" ? rec.snippet : null;
  const confidence = typeof rec.confidence === "number" ? rec.confidence : null;
  if (!snippet?.trim() && !confidence) return null;
  const source =
    rec.source === "vision" || rec.source === "computed" || rec.source === "text"
      ? (rec.source as "text" | "vision" | "computed")
      : "text";
  const page = typeof rec.page === "number" && rec.page >= 1 ? Math.round(rec.page) : null;
  return { snippet, confidence, source, page };
}
