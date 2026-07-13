"use client";

import { useState } from "react";
import { ADDENDUM_CHANGE } from "../lib/sampleTrace";
import {
  ConflictComparison,
  TraceStateChip,
  PrototypeTag,
} from "../components/primitives";
import { usePrefersReducedMotion } from "../lib/useTrace";

export default function AddendumReconciliationPrototype() {
  const [applied, setApplied] = useState(false);
  const reduced = usePrefersReducedMotion();
  const c = ADDENDUM_CHANGE;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">Addendum reconciliation</h1>
            <PrototypeTag intensity="focused" />
          </div>
          <p className="mt-1 text-sm text-text-muted">
            A material change — shown before it&apos;s applied. Original term, superseding clause, and everything it reflows.
          </p>
        </div>
        <TraceStateChip state={applied ? "applied" : "proposed"} />
      </header>

      {/* The change itself — both sources visible, never a silent overwrite. */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="reos-label mb-3 text-text-subtle">Closing date · changed by Addendum 2</div>
        <ConflictComparison
          original={{ label: c.source.label, field: c.source.field, value: c.source.value, page: c.source.page, clause: c.source.clause }}
          superseding={{ label: c.supersededBy.label, field: c.supersededBy.field, value: c.supersededBy.value, page: c.supersededBy.page, clause: c.supersededBy.clause, confidence: c.supersededBy.confidence }}
        />
      </section>

      {/* Downstream impact — the consequence, shown before applying. */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="reos-label mb-3 text-text-subtle">
          Downstream impact {applied ? "· applied" : "· preview"}
        </div>
        <ul className="space-y-2">
          {c.downstream.map((d, i) => (
            <li
              key={d.kind}
              className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${applied ? "border-brand-200 bg-brand-50/50 dark:bg-brand-950/20" : "border-dashed border-border bg-surface-2/40"} ${applied && !reduced ? "atlas-transfer" : ""}`}
              style={applied && !reduced ? { animationDelay: `${i * 90}ms` } : undefined}
            >
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${applied ? "bg-brand-500" : "bg-border-strong"}`} />
              <div>
                <div className="text-sm font-medium text-text">{d.label}</div>
                <div className="text-xs text-text-muted">{d.detail}</div>
              </div>
              {applied && <span className="ml-auto text-xs text-brand-700">updated</span>}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setApplied(true)}
          disabled={applied}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {applied ? "Applied — closing moved to Jul 21" : "Apply the addendum"}
        </button>
        {applied && (
          <button type="button" onClick={() => setApplied(false)} className="text-sm text-text-muted hover:text-text hover:underline">
            Undo
          </button>
        )}
        <span className="text-xs text-text-subtle">
          {applied ? "6 deadlines reflowed · 4 tasks rescheduled · 2 calendar events updated." : "Nothing changes until you approve. This is a proposed change."}
        </span>
      </div>
    </div>
  );
}
