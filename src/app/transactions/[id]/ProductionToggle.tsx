"use client";

/**
 * ProductionToggle — exclude this transaction from /production,
 * /digest, and /sources rollups without deleting it.
 *
 * Used for migrated deals whose closingDate landed in the wrong year
 * or one-off non-production records (referrals out, training files,
 * personal/internal moves). Editing the closingDate fixes most cases;
 * this toggle is the escape hatch for the rest.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/ToastProvider";
import { toDateInputValue } from "@/lib/dates";

export function ProductionToggle({
  transactionId,
  initial,
  closingDateIso,
  status,
}: {
  transactionId: string;
  initial: boolean;
  closingDateIso: string | null;
  status: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [enabled, setEnabled] = useState(initial);
  const [closing, setClosing] = useState(toDateInputValue(closingDateIso));
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function patch(payload: {
    excludeFromProduction?: boolean;
    closingDate?: string | null;
  }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? res.statusText);
      }
      toast.success("Saved");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-3 rounded-md border border-border bg-surface p-3 text-sm">
      <div className="reos-label mb-2">Production rollups</div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => {
              setEnabled(e.target.checked);
              void patch({ excludeFromProduction: e.target.checked });
            }}
            className="h-4 w-4 accent-brand-600"
          />
          <span>
            Exclude from{" "}
            <span className="font-medium">Production / Digest / Sources</span>
          </span>
        </label>
        {status === "closed" && (
          <label className="ml-auto flex items-center gap-2 text-xs text-text-muted">
            Closing date
            <input
              type="date"
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
              onBlur={() =>
                closing !== toDateInputValue(closingDateIso) &&
                patch({ closingDate: closing || null })
              }
              disabled={busy}
              className="rounded border border-border bg-surface-2 px-2 py-1 text-sm"
            />
          </label>
        )}
      </div>
      {enabled && (
        <p className="mt-2 text-xs text-text-muted">
          This deal is hidden from year-by-year production rollups. Toggle off
          to include it again.
        </p>
      )}
    </section>
  );
}
