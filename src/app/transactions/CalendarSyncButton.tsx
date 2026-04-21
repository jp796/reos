"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Lock } from "lucide-react";
import { cn } from "@/lib/cn";

type Stage = "offer" | "counter" | "executed" | "unknown" | null;

export function CalendarSyncButton({
  transactionId,
  contractStage,
}: {
  transactionId: string;
  /**
   * Gates the sync: only enabled when the contract is fully
   * executed (both buyer + seller signed). Pre-executed dates
   * may shift, so syncing them to your calendar would just
   * create noise you'd have to delete.
   *
   * Undefined / null treated as legacy (allow sync — we didn't
   * know stage before this field existed).
   */
  contractStage?: Stage;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // Only block when we KNOW it's pre-executed; null/undefined = legacy pass-through
  const locked =
    contractStage === "offer" || contractStage === "counter";

  async function onClick() {
    if (locked) return;
    setBusy(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(
        `/api/automation/sync-calendar/${transactionId}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error || res.statusText);
        return;
      }
      const r = data.result ?? {};
      setMsg(
        `Created ${r.created ?? 0} · linked ${r.alreadyLinked ?? 0} · skipped ${r.skipped ?? 0}${
          (r.errors?.length ?? 0) > 0 ? ` · ${r.errors.length} err` : ""
        }`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setIsError(true);
      setMsg(err instanceof Error ? err.message : "sync failed");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending || locked;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={
          locked
            ? "Contract not fully executed yet — dates may still change"
            : undefined
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
          contractStage === "executed"
            ? "border-brand-500 bg-brand-50 text-brand-700 shadow-sm hover:bg-brand-100"
            : "border-border bg-surface text-text hover:border-border-strong",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {locked ? (
          <Lock className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {busy ? "Syncing…" : locked ? "Sync locked" : "Sync to Calendar"}
      </button>
      {locked && (
        <span className="text-[10px] text-text-muted">
          waiting on executed contract
        </span>
      )}
      {msg && (
        <span
          className={`text-[10px] ${isError ? "text-red-600" : "text-text-muted"}`}
        >
          {msg}
        </span>
      )}
    </div>
  );
}
