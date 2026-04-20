"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ReconcileSSButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function run() {
    setBusy(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(
        "/api/automation/reconcile-settlement-statements?days=365&max=2000",
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
        `Scanned ${r.scanned ?? 0} · SS attachments ${r.ssCandidates ?? 0} · parsed ${r.parsed ?? 0} · queued ${r.queued ?? 0}`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setIsError(true);
      setMsg(err instanceof Error ? err.message : "reconcile failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy || isPending}
        className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-text hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Reconciling…" : "📑 Reconcile SS (365d)"}
      </button>
      {msg && (
        <span
          className={`max-w-sm text-right text-[11px] ${
            isError ? "text-red-600" : "text-text-muted"
          }`}
        >
          {msg}
        </span>
      )}
    </div>
  );
}
