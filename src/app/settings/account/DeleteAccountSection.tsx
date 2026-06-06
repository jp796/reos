"use client";

/**
 * Delete / Restore account section. Two rendering modes:
 *   - Active account: shows "Danger zone" + Delete button. Click
 *     opens a confirm-typed modal requiring the user to type the
 *     exact business name (matches the API's confirmation gate).
 *   - Scheduled-for-deletion account: shows the countdown + a
 *     Restore button that calls /api/account/restore.
 *
 * On success the page refreshes via router.refresh() so the
 * server-side state reloads (status row, banner across the app).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  businessName: string;
  /** ISO timestamp string or null. */
  deletionRequestedAt: string | null;
}

const GRACE_DAYS = 30;

export function DeleteAccountSection({
  businessName,
  deletionRequestedAt,
}: Props) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Scheduled state
  if (deletionRequestedAt) {
    const scheduledDate = new Date(deletionRequestedAt);
    const purgeAt = new Date(
      scheduledDate.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
    const daysLeft = Math.max(
      0,
      Math.ceil((purgeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );

    async function restore() {
      setError(null);
      startTransition(async () => {
        try {
          const res = await fetch("/api/account/restore", { method: "POST" });
          const data = (await res.json()) as { ok?: boolean; error?: string; stripe?: string };
          if (!res.ok || !data.ok) {
            setError(data.error ?? "Failed to restore account");
            return;
          }
          if (data.stripe === "needs_resubscribe") {
            setError(
              "Account restored — but your Stripe subscription already ended. Please re-subscribe from Settings → Billing.",
            );
          }
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Network error");
        }
      });
    }

    return (
      <section className="rounded-lg border border-amber-400/40 bg-amber-50/60 p-5 dark:border-amber-500/30 dark:bg-amber-950/30">
        <h2 className="font-display text-base font-semibold text-amber-900 dark:text-amber-200">
          Account scheduled for deletion
        </h2>
        <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">
          We&rsquo;ll permanently delete this account and all its data on{" "}
          <span className="font-semibold">
            {purgeAt.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>{" "}
          ({daysLeft} day{daysLeft === 1 ? "" : "s"} from now). You can restore
          it any time before then.
        </p>
        <button
          type="button"
          onClick={restore}
          disabled={pending}
          className="mt-4 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
        >
          {pending ? "Restoring…" : "Restore account"}
        </button>
        {error && (
          <p className="mt-3 text-xs text-red-700 dark:text-red-300">{error}</p>
        )}
      </section>
    );
  }

  // Active state
  async function submitDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: typed }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setError(data.error ?? "Failed to schedule deletion");
          return;
        }
        setConfirmOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      }
    });
  }

  return (
    <section className="rounded-lg border border-red-300/40 bg-red-50/40 p-5 dark:border-red-500/30 dark:bg-red-950/20">
      <h2 className="font-display text-base font-semibold text-red-900 dark:text-red-200">
        Danger zone
      </h2>
      <p className="mt-2 text-sm text-red-900/90 dark:text-red-200/90">
        Deleting your account cancels your Stripe subscription at the end of
        the current billing period and schedules{" "}
        <span className="font-semibold">all tenant data</span> — contacts,
        transactions, documents, integrations — for permanent removal in{" "}
        {GRACE_DAYS} days. You can restore from this screen any time before
        the {GRACE_DAYS}-day window closes.
      </p>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          setError(null);
          setConfirmOpen(true);
        }}
        className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
      >
        Delete account…
      </button>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl">
            <h3 className="font-display text-lg font-semibold text-text">
              Confirm account deletion
            </h3>
            <p className="mt-2 text-sm text-text-muted">
              Type{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium">
                {businessName}
              </code>{" "}
              below to confirm. This cancels your subscription and starts the{" "}
              {GRACE_DAYS}-day countdown.
            </p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={businessName}
              autoFocus
              className="mt-4 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            {error && (
              <p className="mt-3 text-xs text-red-700 dark:text-red-300">{error}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDelete}
                disabled={pending || typed !== businessName}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Scheduling…" : "Schedule deletion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
