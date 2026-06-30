"use client";

/**
 * DealSynthesisPanel — the deal's CURRENT STATE, reconciled across every
 * document. Renders a stored snapshot (transaction.synthesisJson) so it's
 * instant; the "Sync from documents" button re-runs synthesis (cheap —
 * only new docs are analyzed) and refreshes.
 *
 * Shows: merged timeline dates, contingency statuses (inspection removed,
 * etc.), and the list of what changed since the contract.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../ToastProvider";
import type { SynthesisSnapshot } from "@/services/core/DocumentSynthesisService";

const DATE_LABELS: Array<[string, string]> = [
  ["effectiveDate", "Contract"],
  ["closingDate", "Closing"],
  ["possessionDate", "Possession"],
  ["inspectionDeadline", "Inspection"],
  ["inspectionObjectionDeadline", "Insp. objection"],
  ["financingDeadline", "Financing"],
  ["titleCommitmentDeadline", "Title commitment"],
  ["earnestMoneyDueDate", "Earnest money"],
];

const RESOLVED = new Set(["resolved", "removed", "satisfied", "waived"]);

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (RESOLVED.has(s))
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (s === "objected")
    return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  return "border-border bg-surface-2 text-text-muted";
}

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function DealSynthesisPanel({
  transactionId,
  snapshot,
  synthesizedAt,
}: {
  transactionId: string;
  snapshot: SynthesisSnapshot | null;
  synthesizedAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function sync(force: boolean) {
    setBusy(true);
    try {
      const r = await fetch(`/api/transactions/${transactionId}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "synthesis failed");
      toast.success("Synced from documents", data.summary ?? "Current state rebuilt.");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Sync failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-medium">Current state</h2>
        <p className="text-xs text-text-muted">
          Reconciled across all documents · synced {relTime(synthesizedAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => sync(false)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-60"
        >
          {busy ? "Syncing…" : "Sync from documents"}
        </button>
      </div>
    </div>
  );

  if (!snapshot) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-surface-2/30 p-4">
        {header}
        <p className="text-sm text-text-muted">
          Not synthesized yet. Upload the contract and any addenda, notices, or
          disclosures — or click <span className="font-medium">Sync from documents</span> — and
          I&apos;ll read them together to build the current timeline and contingency status.
        </p>
      </section>
    );
  }

  const updated = snapshot.contingencies.filter((c) => c.status !== "applies");

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      {header}

      {/* summary line */}
      <p className="text-sm text-text">{snapshot.summary}</p>

      {/* contingencies */}
      {snapshot.contingencies.length > 0 && (
        <div className="mt-4">
          <div className="reos-label mb-1.5 opacity-70">Contingencies</div>
          <ul className="flex flex-wrap gap-2">
            {snapshot.contingencies.map((c, i) => (
              <li
                key={`${c.name}-${i}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(c.status)}`}
                title={c.source ? `per ${c.source}` : undefined}
              >
                <span>{c.name}</span>
                <span className="opacity-60">·</span>
                <span className="uppercase tracking-wide">{c.status}</span>
                {c.date && <span className="opacity-60">{fmtIso(c.date)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* merged timeline */}
      <div className="mt-4">
        <div className="reos-label mb-1.5 opacity-70">Merged timeline</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
          {DATE_LABELS.map(([key, label]) => (
            <div key={key}>
              <div className="text-xs text-text-muted">{label}</div>
              <div className="text-sm font-medium">{fmtIso(snapshot.mergedDates[key] ?? null)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* what changed */}
      {snapshot.changesApplied.length > 0 && (
        <details className="mt-4 group" open={updated.length > 0}>
          <summary className="reos-label cursor-pointer opacity-70 hover:opacity-100">
            What changed ({snapshot.changesApplied.length})
          </summary>
          <ul className="mt-1.5 space-y-1 text-sm text-text-muted">
            {snapshot.changesApplied.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-emerald-500">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
