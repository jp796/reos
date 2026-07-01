"use client";

/**
 * LiveExtractionView — the split-screen "watch it read" experience.
 * Left: the document being read, page by page, in real time. Right: the
 * fields + timeline populating live as each value streams from the model
 * (like watching code get written on one side and the result on the
 * other). Consumes the SSE stream from /api/automation/extract-contracts-stream.
 */

import { useEffect, useRef, useState } from "react";

type Field = { value: unknown; source: "text" | "vision" | "computed" };

interface Props {
  files: File[];
  onComplete: (extraction: Record<string, unknown>, missingCritical: string[]) => void;
  onError: (message: string) => void;
}

// The fields we surface on the right, in the order they matter to a TC.
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

function fmt(kind: string, value: unknown): string {
  if (value == null || value === "") return "";
  if (kind === "money") return `$${Number(value).toLocaleString()}`;
  if (kind === "pct") return `${(Number(value) * 100).toFixed(2)}%`;
  if (kind === "list") return Array.isArray(value) ? value.join(", ") : String(value);
  return String(value);
}

export function LiveExtractionView({ files, onComplete, onError }: Props) {
  const [log, setLog] = useState<Array<{ text: string; kind: "doc" | "status" }>>([]);
  const [fields, setFields] = useState<Record<string, Field>>({});
  const [contingencies, setContingencies] = useState<string[]>([]);
  const [phase, setPhase] = useState<"reading" | "vision" | "merging" | "done">("reading");
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
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            handle(ev);
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
        setPhase("reading");
        setLog((l) => [
          ...l,
          { text: `Document ${ev.index}/${ev.total}: ${ev.name}`, kind: "doc" },
        ]);
      } else if (type === "status") {
        const msg = String(ev.message);
        if (/visually|pages/i.test(msg)) setPhase("vision");
        if (/merg/i.test(msg)) setPhase("merging");
        setLog((l) => [...l, { text: msg, kind: "status" }]);
      } else if (type === "field") {
        const key = String(ev.key);
        if (key === "contingencies" && Array.isArray(ev.value)) {
          setContingencies(
            (ev.value as Array<{ name?: string }>).map((c) => c?.name ?? "").filter(Boolean),
          );
          return;
        }
        setFields((f) => ({
          ...f,
          [key]: { value: ev.value, source: ev.source as Field["source"] },
        }));
      } else if (type === "merged") {
        setPhase("done");
        onComplete(
          ev.extraction as Record<string, unknown>,
          (ev.missingCritical as string[]) ?? [],
        );
      } else if (type === "error") {
        onError(String(ev.message));
      }
    }

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filledCount = DISPLAY.filter((d) => fields[d.key]?.value != null).length;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* LEFT — reading the document */}
      <div className="rounded-lg border border-border bg-surface-2/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              phase === "done" ? "bg-emerald-500" : "animate-pulse bg-brand-500"
            }`}
          />
          <h3 className="text-sm font-medium">
            {phase === "done" ? "Finished reading" : "Reading the document…"}
          </h3>
        </div>
        <div className="max-h-[26rem] space-y-1 overflow-y-auto font-mono text-xs leading-relaxed">
          {log.map((l, i) => (
            <div
              key={i}
              className={
                l.kind === "doc"
                  ? "mt-2 font-semibold text-text"
                  : "text-text-muted"
              }
            >
              {l.kind === "doc" ? "📄 " : "   "}
              {l.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* RIGHT — the extraction building up */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">Extracting the deal</h3>
          <span className="text-xs text-text-muted">{filledCount} fields</span>
        </div>
        <div className="space-y-1.5">
          {DISPLAY.map((d) => {
            const f = fields[d.key];
            const has = f?.value != null && f.value !== "";
            return (
              <div
                key={d.key}
                className={`flex items-center justify-between gap-3 rounded px-2 py-1 text-sm transition-colors ${
                  has ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-transparent"
                }`}
              >
                <span className="text-text-muted">{d.label}</span>
                <span className="flex items-center gap-1.5 text-right font-medium">
                  {has ? (
                    <>
                      {fmt(d.kind, f.value)}
                      {f.source === "computed" && (
                        <span className="rounded bg-accent-100 px-1 text-[10px] text-accent-600">
                          derived
                        </span>
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
        {contingencies.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <div className="reos-label mb-1 opacity-70">Contingencies found</div>
            <div className="flex flex-wrap gap-1.5">
              {contingencies.map((c, i) => (
                <span
                  key={i}
                  className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-muted"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
