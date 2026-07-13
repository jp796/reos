"use client";

import { useMemo, useState } from "react";
import { useTraceRunner } from "../lib/useTrace";
import {
  CONTRACT_FACTS,
  RESULT_GROUPS,
  contractSummary,
  type TraceFact,
} from "../lib/sampleTrace";
import {
  DestinationField,
  ProvenanceBadge,
  RecognitionLabel,
  TraceConnector,
  TraceStateChip,
  TraceSummary,
  PrototypeTag,
} from "../components/primitives";
import { stateForConfidence } from "../lib/traceTokens";

export default function ContractExtractionPrototype() {
  const facts = CONTRACT_FACTS;
  const runner = useTraceRunner(facts.length, { autostart: true });
  const [showLog, setShowLog] = useState(false);

  const committedFacts = facts.slice(0, runner.revealed);
  const activeFact = runner.active >= 0 ? facts[runner.active] : null;
  const summary = useMemo(() => contractSummary(facts), [facts]);
  const currentPage = activeFact?.page ?? committedFacts[committedFacts.length - 1]?.page ?? 1;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">Contract extraction</h1>
            <PrototypeTag intensity="cinematic" />
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Atlas reads the contract and carries each fact to its field. Every value keeps a clickable page marker.
          </p>
        </div>
        <Controls runner={runner} onLog={() => setShowLog((v) => !v)} />
      </header>

      {/* Live region — announces each committed fact for screen readers. */}
      <div aria-live="polite" className="sr-only">
        {runner.lastCommitted >= 0 && facts[runner.lastCommitted]
          ? `${facts[runner.lastCommitted]!.recognition}: ${facts[runner.lastCommitted]!.value}, page ${facts[runner.lastCommitted]!.page}, confidence ${Math.round(facts[runner.lastCommitted]!.confidence * 100)} percent`
          : ""}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(180px,240px)_1.1fr]">
        {/* LEFT — the document source */}
        <SourcePane facts={facts} activeFact={activeFact} committedCount={runner.revealed} currentPage={currentPage} />

        {/* MIDDLE — the active trace bridge */}
        <BridgePane activeFact={activeFact} idle={runner.done || runner.reducedMotion} />

        {/* RIGHT — the structured transaction */}
        <ResultPane facts={facts} committed={runner.revealed} activeIndex={runner.active} />
      </div>

      {runner.done && (
        <TraceSummary
          factsFound={summary.factsFound}
          deadlinesCreated={summary.deadlinesCreated}
          tasksCreated={summary.tasksCreated}
          needsReview={summary.needsReview}
        />
      )}

      {showLog && <ExtractionLog facts={committedFacts} />}
    </div>
  );
}

function Controls({ runner, onLog }: { runner: ReturnType<typeof useTraceRunner>; onLog: () => void }) {
  const btn =
    "rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {runner.reducedMotion ? (
        <span className="rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-text-subtle">
          Reduced motion — all results shown
        </span>
      ) : runner.running ? (
        <button className={btn} onClick={runner.pause}>Pause</button>
      ) : (
        <button className={btn} onClick={runner.play} disabled={runner.done}>Play</button>
      )}
      <button className={btn} onClick={runner.showAll}>Skip animation</button>
      <button className={btn} onClick={runner.showAll}>Show all results</button>
      <button className={btn} onClick={runner.replay}>Replay trace</button>
      <button className={btn} onClick={onLog}>Extraction log</button>
    </div>
  );
}

/* ── Left: document source ────────────────────────────────────────────── */
function SourcePane({ facts, activeFact, committedCount, currentPage }: { facts: TraceFact[]; activeFact: TraceFact | null; committedCount: number; currentPage: number }) {
  const totalPages = Math.max(...facts.map((f) => f.page));
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="reos-label text-text-subtle">Contract to Buy &amp; Sell (WY)</span>
        <span className="text-[11px] text-text-muted tabular-nums">Page {currentPage} / {totalPages}</span>
      </div>
      {/* A representative page — restrained clause lines. Not a customer doc. */}
      <div className="space-y-2 rounded-md border border-border bg-surface-2/40 p-3 font-mono text-[11px] leading-relaxed text-text-muted">
        {facts.map((f, i) => {
          const isActive = activeFact?.id === f.id;
          const isCommitted = i < committedCount;
          return (
            <div
              key={f.id}
              className={`rounded px-1 py-0.5 transition-colors ${isActive ? "atlas-highlight text-text" : isCommitted ? "text-text/70" : "opacity-45"}`}
            >
              <span className="text-text-subtle">{f.clause ?? "—"} </span>
              {f.snippet}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-text-subtle">
        In production this pane renders the actual uploaded PDF; the highlighted line is the exact clause a result came from.
      </p>
    </div>
  );
}

/* ── Middle: the active trace bridge ──────────────────────────────────── */
function BridgePane({ activeFact, idle }: { activeFact: TraceFact | null; idle: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface-2/30 p-3">
      {activeFact ? (
        <div className="w-full text-center">
          <RecognitionLabel active>{activeFact.recognition}</RecognitionLabel>
          <div className="my-1">
            <TraceConnector active />
          </div>
          <div className="atlas-transfer inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50/70 px-2 py-1 text-xs font-medium text-brand-700 dark:bg-brand-950/30">
            {activeFact.value}
          </div>
        </div>
      ) : (
        <div className="text-center text-[11px] text-text-subtle">
          {idle ? "Trace complete — every value keeps its source." : "Locating evidence…"}
        </div>
      )}
    </div>
  );
}

/* ── Right: structured transaction ────────────────────────────────────── */
function ResultPane({ facts, committed, activeIndex }: { facts: TraceFact[]; committed: number; activeIndex: number }) {
  return (
    <div className="space-y-3">
      {RESULT_GROUPS.map((group) => {
        const groupFacts = facts.map((f, i) => ({ f, i })).filter((x) => x.f.group === group);
        if (groupFacts.length === 0) return null;
        const anyCommitted = groupFacts.some((x) => x.i < committed);
        return (
          <div key={group} className={`rounded-lg border p-3 transition-colors ${anyCommitted ? "border-border bg-surface" : "border-dashed border-border/60 bg-surface-2/30"}`}>
            <div className="reos-label mb-2 text-text-subtle">{group}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {groupFacts.map(({ f, i }) => {
                const isCommitted = i < committed;
                const settling = i === committed - 1; // most-recent lands with a settle
                const state = stateForConfidence(f.confidence);
                return (
                  <DestinationField
                    key={f.id}
                    label={f.destinationLabel}
                    value={f.value}
                    committed={isCommitted}
                    settling={settling && activeIndex < 0}
                    state={state}
                    provenance={
                      <ProvenanceBadge page={f.page} clause={f.clause} snippet={f.snippet} confidence={f.confidence} source={f.source} />
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Missing / ambiguous group — honest about what needs review. */}
      <NeedsReviewGroup facts={facts.slice(0, committed)} />
    </div>
  );
}

function NeedsReviewGroup({ facts }: { facts: TraceFact[] }) {
  const flagged = facts.filter((f) => f.confidence < 0.7);
  if (flagged.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
      <div className="reos-label mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-400">
        Missing or ambiguous <TraceStateChip state="needs_review" />
      </div>
      <ul className="space-y-1.5 text-sm">
        {flagged.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2">
            <span className="text-text">{f.destinationLabel}: <span className="font-medium">{f.value}</span></span>
            <ProvenanceBadge page={f.page} clause={f.clause} snippet={f.snippet} confidence={f.confidence} source={f.source} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExtractionLog({ facts }: { facts: TraceFact[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="reos-label mb-2 text-text-subtle">Extraction log</div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-text-subtle">
            <tr>
              <th className="py-1 pr-4 font-medium">Fact</th>
              <th className="py-1 pr-4 font-medium">Value</th>
              <th className="py-1 pr-4 font-medium">Source</th>
              <th className="py-1 pr-4 font-medium">Page</th>
              <th className="py-1 pr-4 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody className="text-text-muted">
            {facts.map((f) => (
              <tr key={f.id} className="border-t border-border">
                <td className="py-1 pr-4 text-text">{f.recognition}</td>
                <td className="py-1 pr-4">{f.value}</td>
                <td className="py-1 pr-4">{f.source}</td>
                <td className="py-1 pr-4 tabular-nums">{f.page}{f.clause ? ` · ${f.clause}` : ""}</td>
                <td className="py-1 pr-4 tabular-nums">{Math.round(f.confidence * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
