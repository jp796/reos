"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function InvoiceScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function run() {
    setBusy(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch("/api/automation/scan-invoices", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error ?? res.statusText);
        return;
      }
      setMsg(
        `Scanned ${data.scanned} · created ${data.created} · skipped ${data.skipped}${
          data.errored > 0 ? ` · ${data.errored} err` : ""
        }`,
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setIsError(true);
      setMsg(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 5000);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
      >
        {busy ? "Scanning…" : "Scan invoices"}
      </button>
      {msg && (
        <div
          className={`mt-2 rounded border px-2 py-1 text-xs ${isError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
