"use client";

/**
 * Convert-to-Transaction button — visible only when the underlying
 * Transaction has status='listing'. Stamps contractDate, flips
 * status to 'active', optionally toggles dual-agency.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function ConvertListingButton({
  transactionId,
}: {
  transactionId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [contractDate, setContractDate] = useState(today);
  const [closingDate, setClosingDate] = useState("");
  const [dualAgency, setDualAgency] = useState(false);

  async function convert() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/convert-to-transaction`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contractDate,
            closingDate: closingDate || undefined,
            dualAgency,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success("Listing converted", "Now an active transaction.");
      router.refresh();
      window.location.reload();
    } catch (e) {
      toast.error("Convert failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section
        id="convert"
        className="mt-6 rounded-md border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/30"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Listing — pre-contract</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Convert to a transaction once an offer is accepted.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
          >
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            Convert to Transaction
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      id="convert"
      className="mt-6 rounded-md border border-brand-300 bg-brand-50/40 p-4 dark:border-brand-200 dark:bg-brand-50/20"
    >
      <h2 className="text-sm font-semibold">Convert listing → transaction</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="reos-label">Contract date</span>
          <input
            type="date"
            value={contractDate}
            onChange={(e) => setContractDate(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="reos-label">Closing date (optional)</span>
          <input
            type="date"
            value={closingDate}
            onChange={(e) => setClosingDate(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-end gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={dualAgency}
            onChange={(e) => setDualAgency(e.target.checked)}
            className="h-4 w-4 accent-brand-600"
          />
          <span className="text-sm">Repping both sides (dual)</span>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={convert}
          disabled={busy}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {busy ? "Converting…" : "Convert"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
