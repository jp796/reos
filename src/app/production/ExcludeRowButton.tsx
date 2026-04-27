"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff } from "lucide-react";

/** Inline "Exclude from production" action on each /production row.
 * One click flips Transaction.excludeFromProduction = true and
 * router-refreshes the list so it disappears immediately. */
export function ExcludeRowButton({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function exclude() {
    if (!window.confirm("Exclude this transaction from production rollups?"))
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ excludeFromProduction: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      startTransition(() => router.refresh());
    } catch {
      // silent — user can retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={exclude}
      disabled={busy}
      title="Exclude from Production / Digest / Sources"
      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text-muted hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
    >
      <EyeOff className="h-3 w-3" strokeWidth={1.8} />
      {busy ? "…" : "Exclude"}
    </button>
  );
}
