"use client";

/**
 * "Re-sync from sources" — one click re-reads the contract, reconciles the
 * document set, and pulls the Gmail smart-folder threads onto the deal.
 * Best-effort per source; reports exactly what each step did.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface StepResult {
  ok: boolean;
  summary: string;
}

export function ResyncButton({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function resync() {
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/resync`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        summary?: string;
        steps?: Record<string, StepResult>;
        error?: string;
      };
      if (!res.ok) {
        toast.error("Re-sync failed", data.error ?? res.statusText);
        return;
      }
      const detail =
        data.steps &&
        Object.values(data.steps)
          .map((s) => `${s.ok ? "✓" : "•"} ${s.summary}`)
          .join("\n");
      toast.success("Re-synced from sources", detail ?? data.summary ?? "Done.");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Re-sync failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={resync}
      disabled={busy}
      title="Re-read the contract, reconcile documents, and pull the Gmail smart-folder threads"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} strokeWidth={2} />
      {busy ? "Re-syncing…" : "Re-sync from sources"}
    </button>
  );
}
