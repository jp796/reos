"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles, Upload, History, ExternalLink } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import { Hint } from "@/app/components/Hint";

const SCAN_TYPES: Array<{
  value: string;
  label: string;
  hint: string;
  needsQuery?: boolean;
}> = [
  {
    value: "smart",
    label: "Smart auto-detect",
    hint: "Run the contract scanner across recent attachments — uses your trusted-TC list to widen the net.",
  },
  {
    value: "contract",
    label: "Accepted contracts",
    hint: "Find executed purchase contracts with future close dates.",
  },
  {
    value: "earnest_money",
    label: "Earnest money receipts",
    hint: "Mark earnest-money milestones complete from receipts in each deal's smart folder.",
  },
  {
    value: "invoice",
    label: "Invoices",
    hint: "Find inspection / HOA / warranty / repair invoices and queue them for review.",
  },
  {
    value: "title_order",
    label: "Title orders",
    hint: "Detect new title orders from known title-company senders.",
  },
  {
    value: "stale_contact",
    label: "Stale contacts (SS check)",
    hint: "Look for closing disclosures on contacts that may have closed deals we don't have tracked.",
  },
  {
    value: "search",
    label: "Free-text search",
    hint: "Query Gmail by name, address, file number, or sender.",
    needsQuery: true,
  },
];

const WINDOWS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
  { value: 730, label: "2 years" },
];

interface RunSummary {
  id: string;
  scanType: string;
  startedAt: string;
  finishedAt: string | null;
  hitsCount: number;
  errorText: string | null;
  paramsJson: Record<string, unknown> | null;
}

interface Hit {
  threadId?: string;
  subject?: string;
  from?: string;
  date?: string | null;
  filename?: string;
  gmailUrl?: string;
  snippet?: string | null;
  // Populated by AcceptedContractScanService when type === "contract"
  // or type === "smart". When present the result row renders with
  // the extracted contract metadata and a per-hit Create button.
  propertyAddress?: string | null;
  buyers?: string[];
  sellers?: string[];
  purchasePrice?: number | null;
  closingDate?: string | null;
  effectiveDate?: string | null;
  titleCompany?: string | null;
  matchedTransactionId?: string | null;
}

function fmtRel(iso: string | null) {
  if (!iso) return "running…";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function typeLabel(t: string) {
  return SCAN_TYPES.find((x) => x.value === t)?.label ?? t;
}

export function ScanRunner({
  trustedSenders,
  recent,
}: {
  trustedSenders: string[];
  recent: RunSummary[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [type, setType] = useState("smart");
  const [windowDays, setWindowDays] = useState(90);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Hit[] | null>(null);
  const [resultMeta, setResultMeta] = useState<string | null>(null);
  const [history, setHistory] = useState(recent);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selected = SCAN_TYPES.find((s) => s.value === type)!;

  // Poll the runs endpoint while a scan is in flight so the recent-
  // history list (and the running indicator) stays fresh without
  // demanding a full page refresh.
  useEffect(() => {
    if (!busy) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    const tick = async () => {
      try {
        const res = await fetch("/api/scan/runs");
        const data = (await res.json()) as { runs?: RunSummary[] };
        if (data.runs) setHistory(data.runs);
      } catch {
        // ignore
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [busy]);

  async function run() {
    if (selected.needsQuery && !query.trim()) {
      toast.error("Enter a query first");
      return;
    }
    setBusy(true);
    setResults(null);
    setResultMeta(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          window: windowDays,
          query: query.trim() || undefined,
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        toast.error(
          "Scan failed",
          (data.error as string) ?? res.statusText,
        );
        return;
      }
      const hits = ((data.hits as Hit[]) ?? []).slice(0, 50);
      setResults(hits);
      setResultMeta(`${hits.length} hit${hits.length === 1 ? "" : "s"}`);
      toast.success(
        "Scan complete",
        `${hits.length} hit${hits.length === 1 ? "" : "s"} · ${typeLabel(type)}`,
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(
        "Scan errored",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      setBusy(false);
    }
  }

  // Per-hit Create button for contract scans. Same body shape that
  // AcceptedContractScanPanel uses, so the server-side create-from-
  // scan endpoint handles both flows identically.
  async function createTransactionFromHit(h: Hit) {
    const address = h.propertyAddress;
    if (!address) {
      toast.error("Can't create", "this hit has no address");
      return;
    }
    const buyerName = h.buyers?.[0] ?? null;
    const sellerName = h.sellers?.[0] ?? null;
    if (
      !confirm(
        `Create transaction?\n\nAddress: ${address}\nBuyer: ${buyerName ?? "—"}\nSeller: ${sellerName ?? "—"}\nClosing: ${h.closingDate ?? "—"}`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/automation/create-from-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          buyerName,
          sellerName,
          closingDate: h.closingDate,
          effectiveDate: h.effectiveDate,
          purchasePrice: h.purchasePrice,
          titleCompany: h.titleCompany,
          threadId: h.threadId,
          messageId: h.threadId,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        transactionId?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error("Create failed", data.error ?? `HTTP ${res.status}`);
        return;
      }
      toast.success("Transaction created", address);
      // Optimistically mark this hit as matched so the row swaps
      // to a "View transaction" link without waiting for a refresh.
      setResults(
        (prev) =>
          prev?.map((x) =>
            x.threadId === h.threadId
              ? { ...x, matchedTransactionId: data.transactionId ?? null }
              : x,
          ) ?? null,
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(
        "Create errored",
        e instanceof Error ? e.message : "unknown",
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Run panel */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="block">
            <span className="reos-label">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              {SCAN_TYPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="reos-label">Window</span>
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
              disabled={busy}
              className="mt-1 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              {WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <Hint
            label={
              busy
                ? "Scan in progress — check the history below for results when finished."
                : "Run the selected scan against the chosen window. Hits show inline."
            }
          >
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              {busy ? "Scanning…" : "Run scan"}
            </button>
          </Hint>
        </div>

        {selected.needsQuery && (
          <label className="mt-3 block">
            <span className="reos-label">Query</span>
            <div className="relative mt-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={busy}
                placeholder="name, address, file number, sender…"
                className="w-full rounded border border-border bg-surface-2 py-1.5 pl-7 pr-3 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          </label>
        )}

        <p className="mt-2 text-xs text-text-muted">{selected.hint}</p>
        {trustedSenders.length > 0 && (type === "smart" || type === "contract") && (
          <p className="mt-1 text-[11px] text-text-subtle">
            Trusted senders applied: {trustedSenders.join(", ")}
          </p>
        )}

        {/* Manual upload entry — same pipeline, different source */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-text-muted">
          <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span>Got a PDF instead?</span>
          <a
            href="/transactions?upload=1"
            className="font-medium text-brand-700 hover:text-brand-600"
          >
            Upload contract → create transaction
          </a>
        </div>
      </section>

      {/* Live results */}
      {results && (
        <section className="rounded-md border border-border bg-surface p-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">
              Results · <span className="text-text-muted">{resultMeta}</span>
            </h2>
            <button
              type="button"
              onClick={() => setResults(null)}
              className="text-xs text-text-muted hover:text-text"
            >
              Clear
            </button>
          </div>
          {results.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-surface-2/40 px-3 py-4 text-center text-sm text-text-muted">
              No hits in that window.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {results.map((h, i) => {
                // Contract / smart scans return extracted contract
                // metadata; surface a Create button per hit so the
                // user doesn't have to copy details into the manual
                // upload form. Other scan types (invoice, title,
                // stale_contact) render the lite row.
                const isContractHit =
                  (type === "contract" || type === "smart") &&
                  !!h.propertyAddress;

                return (
                  <li
                    key={h.threadId ?? i}
                    className="flex items-start gap-2 rounded border border-border bg-surface-2/40 p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-text">
                        {h.subject ?? h.filename ?? "(no subject)"}
                      </div>
                      <div className="truncate text-xs text-text-muted">
                        {h.from ?? ""}
                        {h.date && ` · ${h.date}`}
                        {h.filename && h.subject && ` · ${h.filename}`}
                      </div>
                      {isContractHit && (
                        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-text">
                          <div>
                            <span className="text-text-muted">Address:</span>{" "}
                            <span className="font-medium">{h.propertyAddress}</span>
                          </div>
                          <div>
                            <span className="text-text-muted">Closing:</span>{" "}
                            <span className="tabular-nums">
                              {h.closingDate ?? "—"}
                            </span>
                          </div>
                          {h.buyers && h.buyers.length > 0 && (
                            <div>
                              <span className="text-text-muted">Buyer:</span>{" "}
                              {h.buyers.join(", ")}
                            </div>
                          )}
                          {h.sellers && h.sellers.length > 0 && (
                            <div>
                              <span className="text-text-muted">Seller:</span>{" "}
                              {h.sellers.join(", ")}
                            </div>
                          )}
                          {h.purchasePrice != null && (
                            <div>
                              <span className="text-text-muted">Price:</span>{" "}
                              <span className="tabular-nums">
                                ${h.purchasePrice.toLocaleString()}
                              </span>
                            </div>
                          )}
                          {h.titleCompany && (
                            <div>
                              <span className="text-text-muted">Title:</span>{" "}
                              {h.titleCompany}
                            </div>
                          )}
                        </div>
                      )}
                      {h.snippet && !isContractHit && (
                        <div className="mt-1 line-clamp-2 text-xs text-text-subtle">
                          {h.snippet}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {isContractHit && (
                        h.matchedTransactionId ? (
                          <a
                            href={`/transactions/${h.matchedTransactionId}`}
                            className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:border-emerald-500"
                          >
                            View transaction
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => createTransactionFromHit(h)}
                            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand-500"
                          >
                            Create transaction
                          </button>
                        )
                      )}
                      {h.gmailUrl && (
                        <a
                          href={h.gmailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text-muted hover:border-brand-500 hover:text-brand-700"
                        >
                          Open <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* History */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.8} />
          <h2 className="text-sm font-medium">Recent scans</h2>
        </div>
        {history.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-2/40 px-3 py-4 text-center text-sm text-text-muted">
            No scans yet. Run one above.
          </div>
        ) : (
          <ul className="space-y-1">
            {history.map((r) => {
              const params = r.paramsJson ?? {};
              const win = (params.window as number | undefined) ?? null;
              const q = (params.query as string | undefined) ?? null;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded border border-border bg-surface-2/40 px-3 py-1.5 text-xs"
                >
                  <span className="truncate">
                    <span className="font-medium text-text">
                      {typeLabel(r.scanType)}
                    </span>
                    {win ? ` · ${win}d` : ""}
                    {q ? ` · "${q}"` : ""}
                  </span>
                  <span className="shrink-0 text-text-muted">
                    {r.errorText ? (
                      <span className="text-red-700 dark:text-red-300">
                        error · {r.errorText.slice(0, 60)}
                      </span>
                    ) : (
                      <>
                        {r.hitsCount} hit{r.hitsCount === 1 ? "" : "s"} ·{" "}
                        {fmtRel(r.finishedAt ?? r.startedAt)}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
