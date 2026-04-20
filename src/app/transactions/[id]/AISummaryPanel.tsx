"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  transactionId: string;
  initialSummary: string | null;
  initialUpdatedAt: string | null;
}

function fmtRelative(iso: string | null) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function AISummaryPanel({
  transactionId,
  initialSummary,
  initialUpdatedAt,
}: Props) {
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function regenerate() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/ai-summary`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setSummary(data.summary);
      setUpdatedAt(new Date().toISOString());
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-md border border-border bg-gradient-to-br from-neutral-50 to-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium">AI summary</h2>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {summary && <span>updated {fmtRelative(updatedAt)}</span>}
          <button
            type="button"
            onClick={regenerate}
            disabled={busy || isPending}
            className="rounded border border-border-strong bg-surface px-2 py-1 font-medium text-text hover:border-border-strong disabled:opacity-50"
          >
            {busy ? "Thinking…" : summary ? "Regenerate" : "Generate"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {err}
        </div>
      )}

      {summary ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-text">
          {summary}
        </p>
      ) : (
        <p className="mt-3 text-sm text-text-muted">
          No AI summary yet. Click Generate to have Atlas write a status brief
          from this transaction&apos;s milestones, tasks, risk factors, and
          recent Gmail threads.
        </p>
      )}
    </section>
  );
}
