"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline "Mark closed" affordance for a transaction row. One click
 * flips status -> closed, sets closingDate to today (if unset),
 * cascades any still-pending milestones to completed.
 */
export function QuickCloseButton({
  transactionId,
  disabled,
}: {
  transactionId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Mark this transaction closed?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "closed",
          closingDate: new Date().toISOString().slice(0, 10),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        window.alert(data?.error ?? `Close failed (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="rounded border border-border bg-surface px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
      title="Mark closed + auto-complete any pending milestones"
    >
      {busy ? "…" : "Mark closed"}
    </button>
  );
}
