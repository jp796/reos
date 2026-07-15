"use client";

/**
 * Atlas Trace §4 — addendum reconciliation. When a later document (counter
 * offer / addendum) changes a material term, Atlas shows BOTH values instead
 * of silently overwriting: the superseded original (struck through, with its
 * page) and the winning value (highlighted, with its page + confidence). The
 * whole point is that a changed closing date is never a silent edit.
 *
 * Shape matches ContractExtractionService.FieldConflict. Value formatting is
 * caller-supplied (money/date/text) via `format`, defaulting to String().
 */

import { ConfidenceMarker } from "./ProvenanceBadge";

export interface ConflictSide {
  value: unknown;
  snippet: string | null;
  page: number | null;
  confidence: number | null;
  effectiveDate: string | null;
}

export interface Conflict {
  key: string;
  label: string;
  original: ConflictSide;
  superseding: ConflictSide;
}

function docLabel(side: ConflictSide, fallback: string): string {
  if (!side.effectiveDate) return fallback;
  const d = new Date(`${side.effectiveDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return fallback;
  return `${fallback} · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function ConflictComparison({
  conflict,
  format = (v) => (v == null ? "—" : String(v)),
}: {
  conflict: Conflict;
  format?: (value: unknown) => string;
}) {
  const { label, original, superseding } = conflict;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      <div className="rounded-md border border-border bg-surface-2/50 p-3">
        <div className="reos-label text-text-subtle">{docLabel(original, "Original")}</div>
        <div className="mt-1 text-sm text-text-muted line-through decoration-text-subtle/60">
          {label}: {format(original.value)}
        </div>
        {original.page != null && (
          <div className="mt-1 text-[10px] text-text-subtle">Page {original.page}</div>
        )}
      </div>
      <div className="hidden text-brand-500 sm:block" aria-hidden>
        →
      </div>
      <div className="rounded-md border border-brand-200 bg-brand-50/60 p-3 dark:bg-brand-950/30">
        <div className="reos-label text-brand-700">{docLabel(superseding, "Amended")} · supersedes</div>
        <div className="mt-1 text-sm font-medium text-text">
          {label}: {format(superseding.value)}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-text-subtle">
          {superseding.page != null && <span>Page {superseding.page}</span>}
          {superseding.confidence != null && <ConfidenceMarker confidence={superseding.confidence} />}
        </div>
      </div>
    </div>
  );
}

/** Compact, single-line reconciliation chip for tight spots (e.g. a timeline
 *  milestone row): "was Jul 10 → Jul 24". Click-free, provenance-light. */
export function ConflictInline({
  conflict,
  format = (v) => (v == null ? "—" : String(v)),
}: {
  conflict: Conflict;
  format?: (value: unknown) => string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      <span className="line-through decoration-amber-800/50">{format(conflict.original.value)}</span>
      <span aria-hidden>→</span>
      <span>{format(conflict.superseding.value)}</span>
      <span className="font-normal text-amber-700/80 dark:text-amber-400/80">amended</span>
    </span>
  );
}
