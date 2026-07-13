"use client";

import { useState } from "react";
import { EMAIL_EVIDENCE } from "../lib/sampleTrace";
import {
  AtlasReceipt,
  TraceConnector,
  TraceStateChip,
  PrototypeTag,
  RecognitionLabel,
} from "../components/primitives";
import { usePrefersReducedMotion } from "../lib/useTrace";

export default function EmailToMilestonePrototype() {
  const e = EMAIL_EVIDENCE;
  const reduced = usePrefersReducedMotion();
  const [applied, setApplied] = useState(reduced);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">Email → milestone</h1>
            <PrototypeTag intensity="micro" />
          </div>
          <p className="mt-1 text-sm text-text-muted">
            One sentence from the title company becomes completed work — with a receipt you can inspect and correct.
          </p>
        </div>
        <TraceStateChip state={applied ? "verified" : "found"} />
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_140px_1fr] md:items-center">
        {/* Source — the email sentence */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="reos-label mb-2 text-text-subtle">Inbox · {e.from}</div>
          <p className="text-sm leading-relaxed text-text">
            &ldquo;<span className={applied ? "atlas-highlight rounded px-0.5" : ""}>{e.sentence}</span>&rdquo;
          </p>
        </div>

        {/* Bridge */}
        <div className="flex flex-col items-center justify-center">
          <RecognitionLabel active={applied}>{e.recognition}</RecognitionLabel>
          <div className="my-1 w-full"><TraceConnector active={applied} /></div>
        </div>

        {/* Destination — the milestone */}
        <div className={`rounded-lg border p-4 transition-colors ${applied ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20" : "border-dashed border-border bg-surface-2/40"} ${applied && !reduced ? "atlas-settle" : ""}`}>
          <div className="reos-label mb-1 text-text-subtle">Milestone</div>
          <div className="text-sm font-medium text-text">{e.milestone}</div>
          <div className="mt-2">
            {applied
              ? <TraceStateChip state="verified" />
              : <TraceStateChip state="found" />}
          </div>
        </div>
      </div>

      {!applied ? (
        <button
          type="button"
          onClick={() => setApplied(true)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
        >
          Complete from this evidence
        </button>
      ) : (
        <div className="max-w-lg">
          <AtlasReceipt
            action={`Completed “${e.milestone}”`}
            evidenceFrom={e.from}
            evidenceQuote={e.sentence}
            confidenceLabel="Confirmed"
            appliedAt={e.appliedAt}
          />
          <button type="button" onClick={() => setApplied(false)} className="mt-2 text-sm text-text-muted hover:text-text hover:underline">
            Undo completion
          </button>
        </div>
      )}
    </div>
  );
}
