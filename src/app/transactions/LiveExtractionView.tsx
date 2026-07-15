"use client";

/**
 * LiveExtractionView — the cinematic "watch Atlas read" experience (Atlas
 * Trace §3). Left: the document being read in real time. Right: the deal
 * builds in THREE visible phases (deal terms → contingencies → task list).
 *
 * The cinematic layer (§3): field events stream from the extraction engine in
 * bursts, but we PACE them one fact at a time through a small queue so each
 * source→result transformation reads as a discrete, causal step. Every fact
 * lands with a motion beat (value transfer → settle) and leaves a persistent
 * provenance badge — the exact clause + confidence + page Atlas read. This is
 * "first ingestion" intensity; the badge survives after all motion ends.
 *
 * Reduced motion: facts commit immediately (no pacing/animation) and the
 * provenance persists either way, so those users get equivalent information.
 */

import { useEffect, useRef, useState } from "react";
import { ProvenanceBadge } from "@/components/atlas-trace/ProvenanceBadge";
import { ConflictComparison, type Conflict } from "@/components/atlas-trace/ConflictComparison";

type Field = {
  value: unknown;
  source: "text" | "vision" | "computed";
  confidence: number | null;
  snippet: string | null;
  page: number | null;
};
type FieldEvent = { key: string } & Field;
type Contingency = { name: string; status: string; description?: string };
type Task = {
  title: string;
  dueDate: string | null;
  owner?: string;
  priority?: string;
  category?: string;
};

interface Props {
  files: File[];
  side?: string | null;
  strategy?: string | null;
  onComplete: (
    extraction: Record<string, unknown>,
    missingCritical: string[],
    tasks: Task[],
  ) => void;
  onError: (message: string) => void;
}

const DISPLAY: Array<{ key: string; label: string; kind: "date" | "money" | "pct" | "text" | "list" }> = [
  { key: "propertyAddress", label: "Property", kind: "text" },
  { key: "buyers", label: "Buyer(s)", kind: "list" },
  { key: "sellers", label: "Seller(s)", kind: "list" },
  { key: "purchasePrice", label: "Purchase price", kind: "money" },
  { key: "earnestMoneyAmount", label: "Earnest money", kind: "money" },
  { key: "effectiveDate", label: "Effective date", kind: "date" },
  { key: "earnestMoneyDueDate", label: "Earnest money due", kind: "date" },
  { key: "inspectionDeadline", label: "Inspection deadline", kind: "date" },
  { key: "inspectionObjectionDeadline", label: "Inspection objection", kind: "date" },
  { key: "titleCommitmentDeadline", label: "Title commitment", kind: "date" },
  { key: "titleObjectionDeadline", label: "Title objection", kind: "date" },
  { key: "financingDeadline", label: "Financing deadline", kind: "date" },
  { key: "walkthroughDate", label: "Final walkthrough", kind: "date" },
  { key: "closingDate", label: "Closing", kind: "date" },
  { key: "possessionDate", label: "Possession", kind: "date" },
  { key: "sellerSideCommissionPct", label: "Seller commission", kind: "pct" },
  { key: "buyerSideCommissionPct", label: "Buyer commission", kind: "pct" },
];
const DISPLAY_KEYS = new Set(DISPLAY.map((d) => d.key));

const STANDARD = [
  "inspection", "financing", "appraisal", "title", "insurance", "walkthrough",
  "possession", "hoa", "survey", "disclosure", "sale of", "risk of loss",
];

const PRIORITY_TONE: Record<string, string> = {
  urgent: "text-red-600 dark:text-red-400",
  high: "text-amber-600 dark:text-amber-400",
  normal: "text-text-muted",
  low: "text-text-subtle",
};

/** ms per fact — brisk but readable; the whole point is to watch it land. */
const PER_FACT_MS = 460;

function fmt(kind: string, value: unknown): string {
  if (value == null || value === "") return "";
  if (kind === "money") return `$${Number(value).toLocaleString()}`;
  if (kind === "pct") return `${(Number(value) * 100).toFixed(2)}%`;
  if (kind === "list") return Array.isArray(value) ? value.join(", ") : String(value);
  return String(value);
}

function fmtDate(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Format a value the way its field renders (money/date/pct/text) — used by
 *  the §4 reconciliation cards so both sides read like the deal panel. */
function fmtForKey(key: string, value: unknown): string {
  const d = DISPLAY.find((x) => x.key === key);
  if (!d) return value == null ? "—" : String(value);
  return (d.kind === "date" ? fmtDate(value) : fmt(d.kind, value)) || "—";
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Phase = "reading" | "tasks" | "done";

export function LiveExtractionView({ files, side, strategy, onComplete, onError }: Props) {
  const [log, setLog] = useState<Array<{ text: string; kind: "doc" | "status" | "found" }>>([]);
  const [fields, setFields] = useState<Record<string, Field>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [contingencies, setContingencies] = useState<Contingency[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [phase, setPhase] = useState<Phase>("reading");
  const [pending, setPending] = useState(0); // facts queued but not yet revealed (for the Skip control)
  const logEndRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  // Cinematic queue controls (refs so the SSE closure stays stable).
  const flushAllRef = useRef<(() => void) | null>(null);
  const skipRef = useRef(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const controller = new AbortController();

    // ---- cinematic committer -------------------------------------------
    const queue: FieldEvent[] = [];
    const committed = new Set<string>();
    let pumping = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let donePayload: { extraction: Record<string, unknown>; missingCritical: string[]; tasks: Task[] } | null = null;

    const syncPending = () => setPending(queue.length);

    const commit = (ev: FieldEvent) => {
      committed.add(ev.key);
      setFields((f) => ({
        ...f,
        [ev.key]: { value: ev.value, source: ev.source, confidence: ev.confidence, snippet: ev.snippet, page: ev.page },
      }));
      const dd = DISPLAY.find((d) => d.key === ev.key);
      if (dd) {
        const snip =
          typeof ev.snippet === "string" && ev.snippet.trim()
            ? ` — "${ev.snippet.trim().slice(0, 64)}"`
            : "";
        setLog((l) => [...l, { text: `✓ ${dd.label}: ${fmt(dd.kind, ev.value)}${snip}`, kind: "found" }]);
      }
    };

    const maybeFinish = () => {
      if (donePayload && queue.length === 0 && !pumping) {
        const p = donePayload;
        donePayload = null;
        setPhase("done");
        onComplete(p.extraction, p.missingCritical, p.tasks);
      }
    };

    const pump = () => {
      if (pumping) return;
      const next = queue.shift();
      syncPending();
      if (!next) {
        maybeFinish();
        return;
      }
      if (skipRef.current || prefersReducedMotion()) {
        commit(next);
        pump();
        return;
      }
      pumping = true;
      setActiveKey(next.key);
      commit(next);
      timer = setTimeout(() => {
        setActiveKey(null);
        pumping = false;
        pump();
      }, PER_FACT_MS);
    };

    const flushAll = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      pumping = false;
      setActiveKey(null);
      while (queue.length) commit(queue.shift()!);
      syncPending();
      maybeFinish();
    };
    flushAllRef.current = flushAll;

    const ingestField = (ev: FieldEvent) => {
      if (committed.has(ev.key)) {
        // Already revealed — quietly update in place (e.g. a vision pass
        // supersedes the text read). No re-animation.
        setFields((f) => ({
          ...f,
          [ev.key]: { value: ev.value, source: ev.source, confidence: ev.confidence, snippet: ev.snippet, page: ev.page },
        }));
        return;
      }
      const i = queue.findIndex((q) => q.key === ev.key);
      if (i >= 0) queue[i] = ev;
      else queue.push(ev);
      syncPending();
      pump();
    };
    // --------------------------------------------------------------------

    (async () => {
      try {
        const fd = new FormData();
        for (const f of files) fd.append("file", f);
        if (side) fd.append("side", side);
        if (strategy) fd.append("strategy", strategy);
        const res = await fetch("/api/automation/extract-contracts-stream", {
          method: "POST",
          body: fd,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          onError(`stream failed (${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done: rdone, value } = await reader.read();
          if (rdone) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            try {
              handle(JSON.parse(line.slice(5).trim()));
            } catch {
              /* skip */
            }
          }
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          onError(e instanceof Error ? e.message : "stream error");
        }
      }
    })();

    function handle(ev: Record<string, unknown>) {
      const type = ev.type as string;
      if (type === "doc") {
        setLog((l) => [...l, { text: `Document ${ev.index}/${ev.total}: ${ev.name}`, kind: "doc" }]);
      } else if (type === "status") {
        setLog((l) => [...l, { text: String(ev.message), kind: "status" }]);
      } else if (type === "field") {
        const key = String(ev.key);
        if (key === "contingencies" && Array.isArray(ev.value)) {
          const list = (ev.value as Array<Record<string, unknown>>)
            .map((c) => ({
              name: String(c?.name ?? ""),
              status: String(c?.status ?? "applies"),
              description: c?.description ? String(c.description) : undefined,
            }))
            .filter((c) => c.name);
          setContingencies((prev) => (list.length >= prev.length ? list : prev));
          if (list.length > 0) {
            setLog((l) => [
              ...l,
              { text: `◆ Contingencies: ${list.map((c) => c.name).join(", ")}`, kind: "found" },
            ]);
          }
          return;
        }
        // Only the fields we surface on the deal panel get the cinematic reveal.
        if (!DISPLAY_KEYS.has(key)) return;
        if (ev.value == null || ev.value === "") return;
        ingestField({
          key,
          value: ev.value,
          source: (ev.source as Field["source"]) ?? "text",
          confidence: typeof ev.confidence === "number" ? ev.confidence : null,
          snippet: typeof ev.snippet === "string" ? ev.snippet : null,
          page: typeof ev.page === "number" ? ev.page : null,
        });
      } else if (type === "conflict") {
        // §4 — a later document changed material terms; show both values.
        if (Array.isArray(ev.conflicts)) {
          setConflicts(ev.conflicts as Conflict[]);
          setLog((l) => [
            ...l,
            {
              text: `⇄ Reconciled: ${(ev.conflicts as Conflict[]).map((c) => c.label).join(", ")} changed by a later document`,
              kind: "found",
            },
          ]);
        }
      } else if (type === "merged") {
        // Terms + contingencies done — move to phase 3 (tasks), don't leave.
        setPhase((p) => (p === "done" ? p : "tasks"));
      } else if (type === "task") {
        const t = ev.task as Task;
        if (t?.title) {
          setTasks((prev) => [...prev, t]);
          setLog((l) => [...l, { text: `＋ Task: ${t.title}`, kind: "found" }]);
        }
      } else if (type === "done") {
        // Hold the advance until the cinematic queue has fully drained, so we
        // never cut the reveal short.
        donePayload = {
          extraction: ev.extraction as Record<string, unknown>,
          missingCritical: (ev.missingCritical as string[]) ?? [],
          tasks: (ev.tasks as Task[]) ?? [],
        };
        maybeFinish();
      } else if (type === "error") {
        onError(String(ev.message));
      }
    }

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCustom = (name: string) => !STANDARD.some((s) => name.toLowerCase().includes(s));
  const filledCount = DISPLAY.filter((d) => fields[d.key]?.value != null).length;
  const showSkip = phase !== "done" && pending > 0 && !prefersReducedMotion();

  const steps: Array<{ label: string; state: "done" | "active" | "pending" }> = [
    { label: "Deal terms", state: phase === "reading" ? "active" : "done" },
    { label: "Contingencies", state: phase === "reading" ? "active" : "done" },
    { label: "Task list", state: phase === "done" ? "done" : phase === "tasks" ? "active" : "pending" },
  ];

  return (
    <div className="space-y-3">
      {/* Phase progress header */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {steps.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span
              className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                s.state === "done"
                  ? "bg-emerald-500 text-white"
                  : s.state === "active"
                    ? "animate-pulse bg-brand-500 text-white"
                    : "bg-surface-2 text-text-subtle"
              }`}
            >
              {s.state === "done" ? "✓" : i + 1}
            </span>
            <span className={s.state === "pending" ? "text-text-subtle" : "text-text"}>{s.label}</span>
            {i < steps.length - 1 && <span className="text-text-subtle">→</span>}
          </span>
        ))}
      </div>

      {/* Live-region announcement for the most recent committed fact (a11y). */}
      <span className="sr-only" role="status" aria-live="polite">
        {activeKey ? `Read ${DISPLAY.find((d) => d.key === activeKey)?.label ?? activeKey}` : ""}
      </span>

      <div className="grid gap-4 md:grid-cols-2">
        {/* LEFT — reading the document */}
        <div className="rounded-lg border border-border bg-surface-2/40 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${phase === "done" ? "bg-emerald-500" : "animate-pulse bg-brand-500"}`} />
            <h3 className="text-sm font-medium">
              {phase === "done" ? "Finished" : phase === "tasks" ? "Building the task list…" : "Reading the document…"}
            </h3>
          </div>
          <div className="max-h-[30rem] space-y-1 overflow-y-auto font-mono text-xs leading-relaxed">
            {log.map((l, i) => {
              const isLastFound = l.kind === "found" && i === log.length - 1 && activeKey != null;
              return (
                <div
                  key={i}
                  className={`${
                    l.kind === "doc"
                      ? "mt-2 font-semibold text-text"
                      : l.kind === "found"
                        ? "rounded px-1 text-emerald-600 dark:text-emerald-400"
                        : "text-text-muted"
                  } ${isLastFound ? "atlas-highlight" : ""}`}
                >
                  {l.kind === "doc" ? "📄 " : "   "}
                  {l.text}
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* RIGHT — the deal building up */}
        <div className="max-h-[30rem] space-y-4 overflow-y-auto rounded-lg border border-border bg-surface p-4">
          {/* §4 — Reconciled terms (a later document changed these) */}
          {conflicts.length > 0 && (
            <div className="atlas-provenance rounded-md border border-amber-300/70 bg-amber-50/50 p-3 dark:bg-amber-950/20">
              <div className="reos-label mb-2 flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                <span aria-hidden>⇄</span> Reconciled terms ({conflicts.length}) — a later document changed these
              </div>
              <div className="space-y-2.5">
                {conflicts.map((c) => (
                  <ConflictComparison key={c.key} conflict={c} format={(v) => fmtForKey(c.key, v)} />
                ))}
              </div>
            </div>
          )}

          {/* Phase 1 — Deal terms */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium">Deal terms</h3>
              <span className="flex items-center gap-2 text-xs text-text-muted">
                {showSkip && (
                  <button
                    type="button"
                    onClick={() => {
                      skipRef.current = true;
                      flushAllRef.current?.();
                    }}
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-muted transition-colors hover:border-brand-300 hover:text-brand-700"
                  >
                    Show all now
                  </button>
                )}
                {filledCount} fields
              </span>
            </div>
            <div className="space-y-1">
              {DISPLAY.map((d) => {
                const f = fields[d.key];
                const has = f?.value != null && f.value !== "";
                const isActive = activeKey === d.key;
                return (
                  <div
                    key={d.key}
                    className={`rounded px-2 py-1 text-sm transition-colors ${
                      has ? "bg-emerald-50 dark:bg-emerald-950/30" : ""
                    } ${isActive ? "atlas-settle" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-text-muted">{d.label}</span>
                      <span className={`flex items-center gap-1.5 text-right font-medium ${isActive ? "atlas-transfer" : ""}`}>
                        {has ? (
                          <>
                            {fmt(d.kind, f.value)}
                            {f.source === "computed" && (
                              <span className="rounded bg-accent-100 px-1 text-[10px] text-accent-600">derived</span>
                            )}
                          </>
                        ) : (
                          <span className="text-text-subtle/40">·····</span>
                        )}
                      </span>
                    </div>
                    {has && (f.snippet || f.confidence != null) && (
                      <div className="atlas-provenance mt-1 flex justify-end">
                        <ProvenanceBadge
                          prov={{ snippet: f.snippet, confidence: f.confidence, source: f.source, page: f.page }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Phase 2 — Contingency framework */}
          {contingencies.length > 0 && (
            <div className="border-t border-border pt-3">
              <div className="reos-label mb-1.5 opacity-70">
                Contingency framework ({contingencies.length})
              </div>
              <ul className="space-y-1">
                {contingencies.map((c, i) => {
                  const custom = isCustom(c.name);
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className={custom ? "text-accent-500" : "text-emerald-500"}>{custom ? "✦" : "•"}</span>
                      <span>
                        <span className="font-medium">{c.name}</span>
                        {custom && (
                          <span className="ml-1.5 rounded bg-accent-100 px-1 text-[10px] text-accent-600">new term</span>
                        )}
                        {c.status && c.status !== "applies" && (
                          <span className="ml-1.5 text-xs text-text-muted">({c.status})</span>
                        )}
                        {c.description && <span className="block text-xs text-text-muted">{c.description}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Phase 3 — the REAL AI task list */}
          {(phase !== "reading" || tasks.length > 0) && (
            <div className="border-t border-border pt-3">
              <div className="reos-label mb-1.5 flex items-center gap-2 opacity-70">
                Task list ({tasks.length})
                {phase === "tasks" && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />}
              </div>
              {tasks.length === 0 && phase === "tasks" ? (
                <p className="text-xs text-text-muted">Atlas is writing tasks from the contract…</p>
              ) : (
                <ul className="space-y-1">
                  {tasks.map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-3.5 w-3.5 rounded-sm border border-border" />
                        {t.title}
                      </span>
                      <span className="flex items-center gap-2 text-xs">
                        {t.priority && t.priority !== "normal" && (
                          <span className={PRIORITY_TONE[t.priority] ?? "text-text-muted"}>{t.priority}</span>
                        )}
                        {t.dueDate && <span className="text-text-muted">by {fmtDate(t.dueDate)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
