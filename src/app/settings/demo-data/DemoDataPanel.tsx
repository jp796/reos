"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function DemoDataPanel({ demoCount }: { demoCount: number }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"generate" | "wipe" | null>(null);
  const [, startTransition] = useTransition();
  const [count, setCount] = useState(6);

  async function generate() {
    setBusy("generate");
    try {
      const res = await fetch("/api/admin/demo-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success(`Created ${data.created} demo deals`);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Generate failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  }

  async function wipe() {
    if (!window.confirm(`Delete all ${demoCount} demo deals? This cannot be undone.`))
      return;
    setBusy("wipe");
    try {
      const res = await fetch("/api/admin/demo-data", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success(
        "Demo data wiped",
        `Removed ${data.deletedTransactions} txns + ${data.deletedContacts} contacts`,
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Wipe failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Current demo deals</h2>
          <span className="font-display text-2xl font-bold tabular-nums">
            {demoCount}
          </span>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Tagged isDemo=true · Excluded from analytics rollups · Visible
          on /transactions with a "demo" badge.
        </p>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Generate sample deals</h2>
        <p className="mt-1 text-xs text-text-muted">
          Mix of listings, active, and closed transactions across Wyoming
          properties — with milestones, financials, and contacts. Ready to
          play with morning-tick, Rezen prep, social posts, Atlas chat.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-text-muted">Count</label>
          <input
            type="number"
            min={1}
            max={12}
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value || "6", 10))}
            className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={generate}
            disabled={busy !== null}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy === "generate" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            Generate {count}
          </button>
        </div>
      </div>

      {demoCount > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/40/40 p-4 dark:border-red-900 dark:bg-red-950/30">
          <h2 className="text-sm font-medium">Wipe all demo data</h2>
          <p className="mt-1 text-xs text-text-muted">
            Permanently deletes every transaction, contact, milestone, and
            financial record tagged as demo. Real data untouched.
          </p>
          <button
            type="button"
            onClick={wipe}
            disabled={busy !== null}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-surface px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:bg-surface-2 dark:hover:bg-red-950"
          >
            {busy === "wipe" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            Wipe demo data
          </button>
        </div>
      )}
    </div>
  );
}
