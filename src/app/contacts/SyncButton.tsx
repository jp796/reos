"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SyncButton() {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSync() {
    setIsSyncing(true);
    setMessage(null);
    setIsError(false);

    try {
      const res = await fetch("/api/integrations/fub/sync?limit=10", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMessage(data.error || res.statusText);
        return;
      }
      const processed = data.result?.processed ?? 0;
      const fetched = data.result?.fetched ?? processed;
      const txCreated = data.result?.transactionsCreated ?? 0;
      const total = data.totalContactsInDb ?? 0;
      const txPart = txCreated > 0 ? ` · ${txCreated} txn created` : "";
      setMessage(
        `Synced ${processed}/${fetched} · ${total} total${txPart} · ${data.durationMs}ms`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }

  const busy = isSyncing || isPending;

  return (
    <div className="flex items-center gap-3">
      {message && (
        <span
          className={`text-sm ${isError ? "text-red-600" : "text-neutral-600"}`}
        >
          {message}
        </span>
      )}
      <button
        type="button"
        onClick={handleSync}
        disabled={busy}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync 10 from FUB"}
      </button>
    </div>
  );
}
