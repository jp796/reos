"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";

interface Hit {
  threadId: string;
  subject: string;
  from: string;
  date: string | null;
  filename: string;
  propertyAddress: string | null;
  isNewConstruction: boolean;
  buyers: string[];
  sellers: string[];
  purchasePrice: number | null;
  closingDate: string | null;
  effectiveDate: string | null;
  titleCompany: string | null;
  matchedTransactionId: string | null;
  matchedContactId: string | null;
  matchedContactName: string | null;
  confidence: number;
  signals: string[];
  gmailUrl: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
function daysUntil(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.round((d.getTime() - Date.now()) / (86400_000));
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

/**
 * Scans Gmail for fully-executed purchase contracts with future
 * closing dates. Shows candidates alongside a "create transaction"
 * action for the ones we don't already track.
 */
export function AcceptedContractScanPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [stats, setStats] = useState<{
    scanned: number;
    extracted: number;
    skippedNoExec: number;
    skippedNoFutureClose: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(90);

  async function run() {
    setBusy(true);
    setErr(null);
    setHits(null);
    setStats(null);
    try {
      const res = await fetch("/api/automation/scan-accepted-contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setHits(data.hits ?? []);
      setStats({
        scanned: data.scanned,
        extracted: data.extracted,
        skippedNoExec: data.skippedNoExec,
        skippedNoFutureClose: data.skippedNoFutureClose,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTransaction(h: Hit) {
    const address = h.propertyAddress ?? window.prompt(
      "Property address for this transaction?",
      "",
    );
    if (!address) return;
    // Buyer or Seller name to link contact
    const buyerName = h.buyers[0] ?? null;
    const sellerName = h.sellers[0] ?? null;
    const confirm = window.confirm(
      `Create transaction?\n\nAddress: ${address}\nBuyer: ${buyerName ?? "—"}\nSeller: ${sellerName ?? "—"}\nClosing: ${fmtDate(h.closingDate)}`,
    );
    if (!confirm) return;

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
          messageId: h.threadId, // fallback
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        window.alert(data.error ?? `Failed (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
      // Optimistically mark this hit as matched
      setHits(
        (prev) =>
          prev?.map((x) =>
            x.threadId === h.threadId
              ? { ...x, matchedTransactionId: data.transactionId }
              : x,
          ) ?? null,
      );
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "create failed");
    }
  }

  return (
    <section className="mt-8 rounded-md border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">
          Scan for accepted contracts with future close dates
        </h2>
        <span className="text-xs text-text-muted">
          Finds executed contracts in Gmail that aren&apos;t yet in REOS
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={String(days)}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
        >
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
          <option value="180">180 days</option>
          <option value="365">1 year</option>
        </select>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {busy ? "Scanning…" : "Scan Gmail"}
        </button>
        {stats && (
          <span className="text-xs text-text-muted">
            Scanned {stats.scanned} threads · extracted {stats.extracted}{" "}
            contracts · filtered out {stats.skippedNoExec} not-executed +{" "}
            {stats.skippedNoFutureClose} past-close
          </span>
        )}
      </div>

      {err && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}

      {hits !== null && (
        <div className="mt-4">
          {hits.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No executed contracts with future closings found in the last{" "}
              {days} days.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded border border-border">
              {hits.map((h) => {
                const confPct = Math.round(h.confidence * 100);
                const confTone =
                  h.confidence >= 0.75
                    ? "bg-brand-50 text-brand-700 ring-brand-200"
                    : h.confidence >= 0.55
                      ? "bg-accent-100 text-accent-600 ring-accent-200"
                      : "bg-surface-2 text-text-muted ring-border";
                return (
                  <li
                    key={h.threadId}
                    className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text">
                          {h.propertyAddress ?? h.subject}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${confTone}`}
                          title={h.signals.join(" · ")}
                        >
                          {confPct}% confidence
                        </span>
                        {h.isNewConstruction && (
                          <span
                            className="inline-flex items-center rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-600 ring-1 ring-accent-200"
                            title="Address starts with TBD / Lot — new construction before final address"
                          >
                            new construction
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                        {h.buyers.length > 0 && (
                          <span>Buyer: {h.buyers.join(", ")}</span>
                        )}
                        {h.sellers.length > 0 && (
                          <span>Seller: {h.sellers.join(", ")}</span>
                        )}
                        {h.closingDate && (
                          <span>
                            Close:{" "}
                            <span className="font-medium text-brand-700 tabular-nums">
                              {fmtDate(h.closingDate)}
                            </span>{" "}
                            ({daysUntil(h.closingDate)})
                          </span>
                        )}
                        {h.purchasePrice && (
                          <span className="tabular-nums">
                            {fmtMoney(h.purchasePrice)}
                          </span>
                        )}
                        {h.titleCompany && <span>· {h.titleCompany}</span>}
                      </div>
                      {h.matchedContactName && (
                        <div className="mt-1 text-xs text-text-muted">
                          Matched contact:{" "}
                          <span className="font-medium text-text">
                            {h.matchedContactName}
                          </span>
                        </div>
                      )}
                      <details className="mt-1 text-[11px] text-text-subtle">
                        <summary className="cursor-pointer hover:text-text-muted">
                          Confidence signals
                        </summary>
                        <ul className="mt-1 list-disc pl-4">
                          {h.signals.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={h.gmailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-xs text-text-muted hover:border-brand-500 hover:text-brand-700"
                      >
                        <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
                        Gmail
                      </a>
                      {h.matchedTransactionId ? (
                        <Link
                          href={`/transactions/${h.matchedTransactionId}`}
                          className="inline-flex items-center gap-1 rounded border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                        >
                          Already tracked →
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => createTransaction(h)}
                          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500"
                        >
                          <Plus className="h-3 w-3" strokeWidth={2} />
                          {h.confidence >= 0.75 ? "Create" : "Review + Create"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
