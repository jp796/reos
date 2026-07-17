"use client";

/**
 * UnderwritingBoard — the deal underwriting pipeline. Each card is a candidate
 * you're underwriting (a saved flip analysis with no deal yet). "Flip to deal"
 * converts it into a real REOS transaction, carrying its numbers, and marries
 * the analysis to it. Restrained by design: one property, its best exit, its
 * numbers, one primary action.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Calculator, ArrowRight, Trash2, TrendingUp } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export interface Candidate {
  id: string;
  address: string;
  profit: number;
  exit: string;
  arv: number;
  maxOffer: number;
  offer: number;
  rehab: number;
  updatedAt: string;
}

const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();

export function UnderwritingBoard({ candidates }: { candidates: Candidate[] }) {
  const totalPotential = candidates.reduce((s, c) => s + Math.max(0, c.profit), 0);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-lg font-semibold tracking-tight">Underwriting</h1>
          <p className="mt-1 text-sm text-text-muted">
            Deals you&rsquo;re evaluating. Underwrite the numbers, then flip the ones that go live into real deals.
          </p>
        </div>
        <Link
          href="/flip-calculator"
          className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-500"
        >
          <Calculator className="h-4 w-4" /> New underwrite
        </Link>
      </header>

      {candidates.length > 0 && (
        <div className="mb-6 flex items-center gap-6 border-b border-border pb-4 text-sm">
          <div>
            <div className="font-display text-2xl font-semibold tabular-nums">{candidates.length}</div>
            <div className="text-xs text-text-subtle">underwriting</div>
          </div>
          <div>
            <div className="font-display text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {money(totalPotential)}
            </div>
            <div className="text-xs text-text-subtle">total upside (best exit)</div>
          </div>
        </div>
      )}

      {candidates.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {candidates.map((c) => (
            <CandidateCard key={c.id} candidate={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border px-8 py-16 text-center">
      <TrendingUp className="mx-auto h-8 w-8 text-text-subtle" strokeWidth={1.5} />
      <h2 className="mt-4 font-display text-lg font-semibold">Nothing underwriting yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
        Underwrite a property in the calculator and save it — it lands here as a candidate until you flip it into a deal.
      </p>
      <Link
        href="/flip-calculator"
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
      >
        <Calculator className="h-4 w-4" /> Underwrite your first deal
      </Link>
    </div>
  );
}

function CandidateCard({ candidate: c }: { candidate: Candidate }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const positive = c.profit >= 0;

  async function flipToDeal() {
    setBusy(true);
    try {
      // 1. Create the real deal (flip investor) from the underwriting.
      const created = await fetch("/api/automation/create-from-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: c.address,
          purchasePrice: c.offer || null,
          resaleIntent: true,
          rehabBudget: true,
        }),
      });
      const cd = await created.json();
      if (!created.ok) throw new Error(cd.error ?? "Couldn't create the deal");
      const transactionId = cd.transactionId as string;

      // 2. Marry this analysis to the new deal so its numbers show on the deal page.
      await fetch(`/api/flip-analysis/${c.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });

      toast.success("Deal created", `${c.address} is now a live transaction.`);
      startTransition(() => router.push(`/transactions/${transactionId}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Flip failed");
      setBusy(false);
      setConfirming(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${c.address} from underwriting?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/flip-analysis/${c.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative flex flex-col justify-between rounded-2xl border border-border bg-surface p-5 transition-shadow hover:shadow-md">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-medium leading-snug text-text">{c.address}</h3>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="shrink-0 rounded p-1 text-text-subtle opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
            title="Remove from underwriting"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3">
          <div className={`font-display text-3xl font-semibold tabular-nums ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {money(c.profit)}
          </div>
          <div className="mt-0.5 text-xs text-text-subtle">projected profit · {c.exit}</div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Stat label="Offer" value={money(c.offer)} />
          <Stat label="ARV" value={money(c.arv)} />
          <Stat label="Rehab" value={money(c.rehab)} />
          <Stat label="Max offer" value={money(c.maxOffer)} />
        </dl>
      </div>

      <div className="mt-5">
        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={flipToDeal}
              disabled={busy || pending}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
            >
              {busy || pending ? "Creating…" : "Confirm — create deal"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-full px-3 py-2 text-sm text-text-muted hover:text-text">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-text transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            Flip to deal <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-text-subtle">{label}</dt>
      <dd className="tabular-nums font-medium text-text">{value}</dd>
    </div>
  );
}
