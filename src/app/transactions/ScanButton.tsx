"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ScanThreadResult {
  threadId: string;
  subject: string;
  fromEmail: string;
  action: string;
  confidence: number;
  matchedDomain?: string;
  contactName?: string;
  address?: string;
  transactionCreated?: boolean;
  labelApplied?: string;
  error?: string;
}

interface ScanResult {
  scanned: number;
  detected: number;
  matched: number;
  dispositioned: number;
  transactionsCreated: number;
  labelsApplied: number;
  daysBack: number;
  confidenceThreshold: number;
  pendingStage: string;
  details: ScanThreadResult[];
}

export function ScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  async function handleScan() {
    setBusy(true);
    setError(null);
    setConnectUrl(null);
    try {
      const res = await fetch("/api/automation/scan-title-orders?days=7", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || res.statusText);
        if (data.connectUrl) setConnectUrl(data.connectUrl);
        return;
      }
      setResult(data.result);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleScan}
        disabled={disabled}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Scanning Gmail…" : "Scan Gmail for title orders"}
      </button>

      {connectUrl && (
        <a
          href={connectUrl}
          className="text-xs text-amber-700 underline"
        >
          Connect Google first →
        </a>
      )}

      {error && !connectUrl && (
        <span className="max-w-sm text-right text-xs text-red-600">{error}</span>
      )}

      {result && !error && (
        <div className="max-w-md rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text">
          <div className="font-medium text-text">
            Scanned {result.scanned} · detected {result.detected} · matched{" "}
            {result.matched} · dispositioned {result.dispositioned}
          </div>
          <div className="mt-0.5 text-text-muted">
            {result.transactionsCreated} txn created · {result.labelsApplied}{" "}
            labels applied · last {result.daysBack} days · threshold{" "}
            {result.confidenceThreshold}
          </div>
        </div>
      )}
    </div>
  );
}
