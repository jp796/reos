"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ScanDetail {
  transactionId: string;
  address: string | null;
  milestoneType: string;
  completedAt: string;
  matchedSubject: string;
  matchedVia: "subject" | "filename";
}

interface ScanResult {
  scanned: number;
  completed: number;
  details: ScanDetail[];
}

export function EarnestMoneyScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/automation/scan-earnest-money", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setResult(data);
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:border-border-strong disabled:opacity-50"
      >
        {busy ? "Scanning…" : "Scan earnest money"}
      </button>
      {err && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {err}
        </div>
      )}
      {result && (
        <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
          Scanned {result.scanned} · Completed {result.completed}
          {result.completed > 0 && (
            <ul className="mt-1 space-y-0.5">
              {result.details.slice(0, 5).map((d) => (
                <li key={d.transactionId} className="font-mono">
                  {d.address ?? "—"} · {d.matchedVia}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
