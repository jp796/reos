"use client";

/**
 * Delete-transaction button + "are you sure?" confirmation modal.
 *
 * Owner / coordinator only — surfaced unconditionally; the API
 * enforces role + account scope on the server. Cascade-deletes every
 * dependent row (milestones, docs, financials, calendar events) per
 * schema.prisma onDelete: Cascade.
 *
 * Uses a hand-rolled dialog (not Radix) to avoid pulling in a new
 * package — REOS only needs one confirm modal so far.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function DeleteTransactionButton({
  transactionId,
  propertyAddress,
}: {
  transactionId: string;
  propertyAddress: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe (Cancel) button on open + close on Escape
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function confirmDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `delete failed (${res.status})`);
      toast.success("Transaction deleted", "All related records removed.");
      // Bounce to the index — the row no longer exists, can't stay here.
      router.replace("/transactions");
      router.refresh();
    } catch (e) {
      toast.error(
        "Delete failed",
        e instanceof Error ? e.message : "unknown error",
      );
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-text-muted transition-colors hover:border-danger hover:text-danger"
        title="Delete this transaction"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        Delete
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-txn-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />
          {/* Card */}
          <div className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl animate-in zoom-in-95 fade-in duration-150">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                <Trash2 className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="delete-txn-title"
                  className="font-display text-lg font-semibold text-text"
                >
                  Are you sure you want to continue?
                </h2>
                <p className="mt-1 text-sm text-text-muted">
                  This permanently deletes{" "}
                  <span className="font-medium text-text">
                    {propertyAddress ?? "this transaction"}
                  </span>{" "}
                  and every related record — milestones, documents,
                  financials, calendar events. This{" "}
                  <span className="font-medium text-danger">
                    cannot be undone
                  </span>
                  .
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-border-strong disabled:opacity-50"
              >
                No, keep it
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {busy ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
