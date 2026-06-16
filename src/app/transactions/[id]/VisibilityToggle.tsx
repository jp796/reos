"use client";

/**
 * VisibilityToggle — owner/admin control to restrict a deal to its
 * assigned TC (+ owners/admins). When on, the deal is hidden from every
 * other team member across the list, search, Today, Digest, and by
 * direct link. Rendered only for owners/admins.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function VisibilityToggle({
  transactionId,
  initialRestricted,
  assigneeName,
}: {
  transactionId: string;
  initialRestricted: boolean;
  assigneeName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [restricted, setRestricted] = useState(initialRestricted);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !restricted;
    setBusy(true);
    setRestricted(next);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restrictedToAssignee: next }),
      });
      if (!res.ok) {
        setRestricted(!next);
        toast.error("Couldn't change visibility", (await res.json()).message ?? res.statusText);
        return;
      }
      toast.success(
        next ? "Deal restricted" : "Deal opened to team",
        next
          ? `Now visible only to ${assigneeName ?? "the assigned TC"} + owners/admins.`
          : "Now visible to the whole team again.",
      );
      router.refresh();
    } catch (e) {
      setRestricted(!next);
      toast.error("Couldn't change visibility", e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={
        restricted
          ? "This deal is restricted to its assigned TC + owners/admins. Click to open to the whole team."
          : "Visible to the whole team. Click to restrict to the assigned TC + owners/admins."
      }
      className={`mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        restricted
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
          : "border-border bg-surface text-text-muted hover:border-brand-500 hover:text-brand-700"
      }`}
    >
      {restricted ? (
        <Lock className="h-3.5 w-3.5" strokeWidth={1.8} />
      ) : (
        <LockOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
      {restricted ? "Restricted to assigned TC" : "Visible to whole team"}
    </button>
  );
}
