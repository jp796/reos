"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * "Terminate" — marks a transaction terminated (the deal fell through /
 * the contract was terminated by the parties). Distinct from "dead" (not
 * your deal) and "closed" (successfully closed). Terminated deals drop out
 * of the Active list and group under the Terminated nav section.
 */
export function QuickTerminateButton({
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
        "Mark this transaction TERMINATED?\nThe deal fell through / was terminated. It leaves the Active list and moves to the Terminated group.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "terminated" }),
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
      className="rounded border border-border bg-surface px-2 py-0.5 text-xs text-text-muted transition-colors hover:border-amber-300 hover:text-amber-700 disabled:opacity-50"
      title="Deal fell through — mark terminated"
    >
      {busy ? "…" : "Terminate"}
    </button>
  );
}
