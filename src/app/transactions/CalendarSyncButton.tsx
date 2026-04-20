"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CalendarSyncButton({
  transactionId,
}: {
  transactionId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function onClick() {
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

  const disabled = busy || isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-text transition hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Syncing…" : "📅 Sync to Calendar"}
      </button>
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
