"use client";

/**
 * LiveExtractionView — the split-screen "watch it read" experience.
 * Left: the document being read, page by page, in real time. Right: the
 * deal builds live as each value streams from the model — deal terms,
 * contingencies + provisions (with any non-standard term surfaced as its
 * own row), and a task list derived from the deadlines as they land.
 * Consumes the SSE stream from /api/automation/extract-contracts-stream.
 */

import { useEffect, useRef, useState } from "react";

type Field = { value: unknown; source: "text" | "vision" | "computed" };
type Contingency = { name: string; status: string; description?: string };

interface Props {
  files: File[];
  onComplete: (extraction: Record<string, unknown>, missingCritical: string[]) => void;
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

// A date field → the task it implies (built live as the date lands).
const TASK_FOR_DATE: Record<string, string> = {
  earnestMoneyDueDate: "Deliver earnest money",
  inspectionDeadline: "Complete inspection",
  inspectionObjectionDeadline: "Submit inspection objection",
  titleCommitmentDeadline: "Receive title commitment",
  titleObjectionDeadline: "Submit title objection",
  financingDeadline: "Secure financing",
  walkthroughDate: "Final walkthrough",
  closingDate: "Close",
};

// Standard contingencies — anything else is a custom/new term we surface.
const STANDARD = [
  "inspection", "financing", "appraisal", "title", "insurance", "walkthrough",
  "possession", "hoa", "survey", "disclosure", "sale of", "risk of loss",
];

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

export function LiveExtractionView({ files, onComplete, onError }: Props) {
  const [log, setLog] = useState<Array<{ text: string; kind: "doc" | "status" }>>([]);
  const [fields, setFields] = useState<Record<string, Field>>({});
  const [contingencies, setContingencies] = useState<Contingency[]>([]);
  const [done, setDone] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const controller = new AbortController();

    (async () => {
      try {
        const fd = new FormData();
        for (const f of files) fd.append("file", f);
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
          // Merge — a later doc's richer list replaces the earlier one.
          setContingencies((prev) => (list.length >= prev.length ? list : prev));
          return;
        }
        setFields((f) => ({ ...f, [key]: { value: ev.value, source: ev.source as Field["source"] } }));
      } else if (type === "merged") {
        setDone(true);
        onComplete(ev.extraction as Record<string, unknown>, (ev.missingCritical as string[]) ?? []);
      } else if (type === "error") {
        onError(String(ev.message));
      }
    }

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tasks derived live from whichever deadline fields have landed.
  const tasks = Object.entries(TASK_FOR_DATE)
    .map(([key, label]) => {
      const v = fields[key]?.value;
      return typeof v === "string" && v ? { label, date: v } : null;
    })
    .filter((t): t is { label: string; date: string } => t !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const isCustom = (name: string) =>
    !STANDARD.some((s) => name.toLowerCase().includes(s));

  const filledCount = DISPLAY.filter((d) => fields[d.key]?.value != null).length;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* LEFT — reading the document */}
      <div className="rounded-lg border border-border bg-surface-2/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${done ? "bg-emerald-500" : "animate-pulse bg-brand-500"}`} />
          <h3 className="text-sm font-medium">{done ? "Finished reading" : "Reading the document…"}</h3>
        </div>
        <div className="max-h-[30rem] space-y-1 overflow-y-auto font-mono text-xs leading-relaxed">
          {log.map((l, i) => (
            <div key={i} className={l.kind === "doc" ? "mt-2 font-semibold text-text" : "text-text-muted"}>
              {l.kind === "doc" ? "📄 " : "   "}
              {l.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* RIGHT — the deal building up */}
      <div className="max-h-[30rem] space-y-4 overflow-y-auto rounded-lg border border-border bg-surface p-4">
        {/* Deal terms */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Deal terms</h3>
            <span className="text-xs text-text-muted">{filledCount} fields</span>
          </div>
          <div className="space-y-1">
            {DISPLAY.map((d) => {
              const f = fields[d.key];
              const has = f?.value != null && f.value !== "";
              return (
                <div
                  key={d.key}
                  className={`flex items-center justify-between gap-3 rounded px-2 py-1 text-sm transition-colors ${
                    has ? "bg-emerald-50 dark:bg-emerald-950/30" : ""
                  }`}
                >
                  <span className="text-text-muted">{d.label}</span>
                  <span className="flex items-center gap-1.5 text-right font-medium">
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
              );
            })}
          </div>
        </div>

        {/* Contingencies + provisions (custom terms flagged) */}
        {contingencies.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="reos-label mb-1.5 opacity-70">
              Contingencies &amp; provisions ({contingencies.length})
            </div>
            <ul className="space-y-1">
              {contingencies.map((c, i) => {
                const custom = isCustom(c.name);
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={custom ? "text-accent-500" : "text-emerald-500"}>
                      {custom ? "✦" : "•"}
                    </span>
                    <span>
                      <span className="font-medium">{c.name}</span>
                      {custom && (
                        <span className="ml-1.5 rounded bg-accent-100 px-1 text-[10px] text-accent-600">
                          new term
                        </span>
                      )}
                      {c.status && c.status !== "applies" && (
                        <span className="ml-1.5 text-xs text-text-muted">({c.status})</span>
                      )}
                      {c.description && (
                        <span className="block text-xs text-text-muted">{c.description}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Tasks derived from the deadlines */}
        {tasks.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="reos-label mb-1.5 opacity-70">Task list ({tasks.length})</div>
            <ul className="space-y-1">
              {tasks.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3.5 w-3.5 rounded-sm border border-border" />
                    {t.label}
                  </span>
                  <span className="text-xs text-text-muted">by {fmtDate(t.date)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
