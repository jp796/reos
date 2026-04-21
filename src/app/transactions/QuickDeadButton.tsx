"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * "Not my deal" — marks a transaction dead with a confirm prompt.
 * Use when a FUB placeholder exists but the underlying deal belonged
 * to another agent (wrong assignedAgent in FUB, title-co CC list
 * blast, etc.).
 */
export function QuickDeadButton({
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
    if (
      !window.confirm(
        "Mark this transaction dead (not your deal)?\nIt'll be hidden from the Active and Closed lists.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "dead" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        window.alert(data?.error ?? `Failed (${res.status})`);
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
      className="rounded border border-border bg-surface px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-red-300 hover:text-danger disabled:opacity-50"
      title="Not your deal — mark dead + hide from lists"
    >
      {busy ? "…" : "Not mine"}
    </button>
  );
}
