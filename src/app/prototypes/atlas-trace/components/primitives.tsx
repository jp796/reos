"use client";

/**
 * Atlas Trace reusable primitives (REOS_05 prototype, deliverable #6).
 * One shared vocabulary so no product surface invents its own version.
 */

import { useState } from "react";
import { STATE_LABEL, STATE_TONE, type TraceState, type TraceIntensity } from "../lib/traceTokens";

/** State chip — the shared interaction-state vocabulary. */
export function TraceStateChip({ state }: { state: TraceState }) {
  const t = STATE_TONE[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${t.text} ${t.ring} bg-surface`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {STATE_LABEL[state]}
    </span>
  );
}

/** Confidence marker — a calm 0–1 indicator, never a fake progress %. */
export function ConfidenceMarker({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const low = confidence < 0.7;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${low ? "text-amber-700 dark:text-amber-400" : "text-text-muted"}`}
      title={`Model confidence ${pct}%`}
    >
      <span className="inline-flex h-1.5 w-8 overflow-hidden rounded-full bg-border">
        <span
          className={`h-full ${low ? "bg-amber-500" : "bg-brand-500"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      {pct}%
    </span>
  );
}

/**
 * Provenance badge — the persistent, clickable source reference. Survives
 * after all motion ends (the whole point of the trace). Click reveals the
 * source-text anchor.
 */
export function ProvenanceBadge({
  page,
  clause,
  snippet,
  confidence,
  source,
  verified,
}: {
  page: number;
  clause?: string;
  snippet: string;
  confidence: number;
  source: "text" | "vision" | "computed";
  verified?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="atlas-provenance relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted transition-colors hover:border-brand-300 hover:text-brand-700"
        title="View source"
      >
        <span className="h-1 w-1 rounded-full bg-brand-500/70" />
        Page {page}{clause ? ` · ${clause}` : ""}
      </button>
      <ConfidenceMarker confidence={confidence} />
      {verified && (
        <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">✓ Verified</span>
      )}
      {source === "computed" && (
        <span className="text-[10px] text-text-subtle" title="Derived from the contract's relative-date rule">
          derived
        </span>
      )}
      {open && (
        <span className="absolute left-0 top-full z-10 mt-1 w-72 rounded-md border border-border bg-surface p-2 text-[11px] italic leading-relaxed text-text shadow-sm">
          &ldquo;{snippet}&rdquo;
          <span className="mt-1 block not-italic text-[10px] text-text-subtle">
            {source === "text" ? "Read from the document text layer" : source === "vision" ? "Read via page-image vision" : "Computed from a relative-date rule in the contract"} · page {page}
          </span>
        </span>
      )}
    </span>
  );
}

/** A recognition label — restrained, says what Atlas saw. */
export function RecognitionLabel({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${active ? "atlas-transfer" : ""} text-text-muted`}
    >
      <span className="h-1 w-1 rounded-full bg-brand-500" />
      {children}
    </span>
  );
}

/**
 * Destination field — where an extracted value lands. `settling` triggers the
 * brief settle highlight; provenance persists beneath.
 */
export function DestinationField({
  label,
  value,
  committed,
  settling,
  state,
  provenance,
}: {
  label: string;
  value: string;
  committed: boolean;
  settling?: boolean;
  state?: TraceState;
  provenance?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-md border p-2.5 transition-colors ${committed ? "border-border bg-surface" : "border-dashed border-border/60 bg-surface-2/40"} ${settling ? "atlas-settle" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="reos-label text-text-subtle">{label}</span>
        {committed && state && <TraceStateChip state={state} />}
      </div>
      <div className={`mt-0.5 text-sm font-medium ${committed ? "text-text" : "text-text-subtle"} ${settling ? "atlas-transfer" : ""}`}>
        {committed ? value : "—"}
      </div>
      {committed && provenance && <div className="mt-1.5">{provenance}</div>}
    </div>
  );
}

/** A thin ink-blue connector between two points (organic slight curve). */
export function TraceConnector({
  active,
  from = { x: 0, y: 20 },
  to = { x: 240, y: 20 },
}: {
  active: boolean;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}) {
  const midX = (from.x + to.x) / 2;
  const d = `M ${from.x},${from.y} C ${midX},${from.y - 8} ${midX},${to.y + 8} ${to.x},${to.y}`;
  const len = Math.hypot(to.x - from.x, to.y - from.y) + 24;
  return (
    <svg width="100%" height="40" viewBox={`0 0 ${Math.max(to.x, 240)} 40`} className="overflow-visible" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke="rgb(37 99 235 / 0.55)"
        strokeWidth={1.5}
        className={active ? "atlas-connector" : ""}
        style={{ ["--atlas-path-len" as string]: len, strokeDashoffset: active ? undefined : 0 }}
      />
    </svg>
  );
}

/** Conflict / supersession comparison — original vs superseding, both shown. */
export function ConflictComparison({
  original,
  superseding,
}: {
  original: { label: string; field: string; value: string; page: number; clause?: string };
  superseding: { label: string; field: string; value: string; page: number; clause?: string; confidence: number };
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      <div className="rounded-md border border-border bg-surface-2/50 p-3">
        <div className="reos-label text-text-subtle">{original.label}</div>
        <div className="mt-1 text-sm text-text-muted line-through decoration-text-subtle/60">
          {original.field}: {original.value}
        </div>
        <div className="mt-1 text-[10px] text-text-subtle">Page {original.page}{original.clause ? ` · ${original.clause}` : ""}</div>
      </div>
      <div className="hidden text-brand-500 sm:block" aria-hidden>→</div>
      <div className="rounded-md border border-brand-200 bg-brand-50/60 p-3 dark:bg-brand-950/30">
        <div className="reos-label text-brand-700">{superseding.label} · supersedes</div>
        <div className="mt-1 text-sm font-medium text-text">
          {superseding.field}: {superseding.value}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-text-subtle">
          Page {superseding.page}{superseding.clause ? ` · ${superseding.clause}` : ""}
          <ConfidenceMarker confidence={superseding.confidence} />
        </div>
      </div>
    </div>
  );
}

/**
 * Atlas Receipt — the persistent, inspectable record of a consequential
 * automated action. Action · Evidence · Confidence · Applied · source/correct.
 */
export function AtlasReceipt({
  action,
  evidenceFrom,
  evidenceQuote,
  confidenceLabel,
  appliedAt,
  onViewSource,
  onCorrect,
}: {
  action: string;
  evidenceFrom: string;
  evidenceQuote: string;
  confidenceLabel: string;
  appliedAt: string;
  onViewSource?: () => void;
  onCorrect?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="reos-label text-text-subtle">Atlas Receipt</div>
      <dl className="mt-2 space-y-2 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-text-subtle">Action</dt>
          <dd className="text-text">{action}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-text-subtle">Evidence</dt>
          <dd className="text-text-muted">
            Email from {evidenceFrom}: <span className="italic text-text">&ldquo;{evidenceQuote}&rdquo;</span>
          </dd>
        </div>
        <div className="flex gap-8">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-text-subtle">Confidence</dt>
            <dd className="text-emerald-700 dark:text-emerald-400">{confidenceLabel}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-text-subtle">Applied</dt>
            <dd className="text-text-muted tabular-nums">{appliedAt}</dd>
          </div>
        </div>
      </dl>
      <div className="mt-3 flex items-center gap-3 text-xs">
        <button type="button" onClick={onViewSource} className="font-medium text-brand-700 hover:underline">
          View source
        </button>
        <span className="text-border-strong">·</span>
        <button type="button" onClick={onCorrect} className="font-medium text-text-muted hover:text-text hover:underline">
          Correct
        </button>
      </div>
    </div>
  );
}

/** Completion summary — real counts, primary action. No arbitrary percentages. */
export function TraceSummary({
  factsFound,
  deadlinesCreated,
  tasksCreated,
  needsReview,
  onReview,
}: {
  factsFound: number;
  deadlinesCreated: number;
  tasksCreated: number;
  needsReview: number;
  onReview?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="font-display text-lg font-semibold">Deal ready for review</h3>
      <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <SummaryStat n={factsFound} label="facts found" />
        <SummaryStat n={deadlinesCreated} label="deadlines created" />
        <SummaryStat n={tasksCreated} label="tasks created" />
        <SummaryStat n={needsReview} label="items need review" tone={needsReview > 0 ? "warn" : "muted"} />
      </ul>
      <button
        type="button"
        onClick={onReview}
        className="mt-4 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
      >
        Review the deal
      </button>
    </div>
  );
}

function SummaryStat({ n, label, tone = "muted" }: { n: number; label: string; tone?: "muted" | "warn" }) {
  return (
    <li>
      <span className={`font-display text-2xl font-semibold tabular-nums ${tone === "warn" && n > 0 ? "text-amber-600" : "text-text"}`}>{n}</span>
      <span className="ml-1.5 text-xs text-text-muted">{label}</span>
    </li>
  );
}

/** Small "PROTOTYPE" + intensity marker so no screen implies live backend. */
export function PrototypeTag({ intensity }: { intensity: TraceIntensity }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
      Prototype · {intensity} trace
    </span>
  );
}
