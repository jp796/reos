"use client";

/**
 * PostCloseTickButton — manually fires the post-close automation
 * sweep. Idempotent — clicking twice does nothing the second time
 * because audit-log dedupe protects against double-creation.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function PostCloseTickButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function fire() {
    setBusy(true);
    try {
      const res = await fetch("/api/automation/post-close/tick", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success(
        "Post-close sweep complete",
        `${data.tasksCreated} new task(s) across ${data.scanned} closed deal(s)`,
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(
        "Sweep failed",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={fire}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
      title="Run post-close automation: creates review-request, gift, NPS, and compliance tasks for closed deals"
    >
      <Sparkles className="h-3 w-3" strokeWidth={2} />
      {busy ? "Sweeping…" : "Post-close sweep"}
    </button>
  );
}
