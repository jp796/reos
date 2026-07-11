"use client";

/**
 * Inline actions for Today's decision queues (remediation §11) — clear or
 * route an item without leaving Today. Best-effort optimistic refresh.
 *
 * Tasks get Complete + Snooze (rescheduling a task is safe). Milestones get
 * Complete ONLY — snoozing a milestone would push its date, and the
 * milestone↔transaction date sync would then corrupt the real contract
 * deadline. You don't snooze a closing; you complete it or open the deal.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock } from "lucide-react";

function snoozeDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  // YYYY-MM-DD — the API's parseInputDate anchors it at local noon.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function TodayQuickActions({
  kind,
  transactionId,
  itemId,
}: {
  kind: "task" | "milestone";
  transactionId: string;
  itemId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "complete" | "snooze">(null);
  const [, startTransition] = useTransition();

  const base =
    kind === "task"
      ? `/api/transactions/${transactionId}/tasks/${itemId}`
      : `/api/transactions/${transactionId}/milestones/${itemId}`;

  async function act(action: "complete" | "snooze", body: Record<string, unknown>) {
    setBusy(action);
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  const btn =
    "inline-flex items-center gap-1 rounded border border-current/20 bg-white/50 px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-white/80 disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/20";

  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <button
        type="button"
        disabled={!!busy}
        onClick={() => act("complete", { completedAt: new Date().toISOString() })}
        className={btn}
        title="Mark complete"
      >
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
        {busy === "complete" ? "…" : "Done"}
      </button>
      {kind === "task" && (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => act("snooze", { dueAt: snoozeDate(3) })}
          className={btn}
          title="Snooze 3 days"
        >
          <Clock className="h-3 w-3" strokeWidth={2} />
          {busy === "snooze" ? "…" : "Snooze 3d"}
        </button>
      )}
    </div>
  );
}
