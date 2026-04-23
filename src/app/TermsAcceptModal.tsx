"use client";

/**
 * First-login Terms-of-Use gate. Rendered by the root layout ONLY
 * when the acting user is signed in AND has not yet accepted terms.
 *
 * Blocking — the modal is non-dismissable (no backdrop close, no X).
 * The user can either Accept and continue, or sign out.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TermsBody } from "./terms/TermsBody";
import { useToast } from "./ToastProvider";

export function TermsAcceptModal({
  signOutAction,
}: {
  signOutAction: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function accept() {
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/terms/accept", { method: "POST" });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        toast.success("Welcome to REOS");
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "failed";
        setErr(msg);
        toast.error("Couldn't record acceptance", msg);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tou-title"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
        <div className="border-b border-border px-6 py-4">
          <h2
            id="tou-title"
            className="font-display text-xl font-semibold"
          >
            Before you continue — Terms of Use
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            REOS is a private workspace. Please read and accept before
            using it.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <TermsBody />
        </div>

        <div className="flex flex-col-reverse items-stretch gap-2 border-t border-border bg-surface-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <form action={signOutAction}>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:text-text sm:w-auto"
            >
              Decline &amp; sign out
            </button>
          </form>
          <div className="flex flex-col items-end gap-1">
            {err && (
              <span className="text-xs text-red-600">{err}</span>
            )}
            <button
              type="button"
              onClick={accept}
              disabled={pending}
              className="w-full rounded-md bg-brand-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 disabled:opacity-60 sm:w-auto"
            >
              {pending ? "Recording…" : "I accept — continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
