"use client";

/**
 * GoogleConnectionPanel — Google account connection state inside
 * Settings → Integrations.
 *
 * Probes /api/auth/google/status on mount; the endpoint actually
 * tries to refresh the access token, so a revoked refresh token
 * surfaces as connected:false even if we still hold an encrypted
 * blob in the DB. Two actions:
 *   - Connect / Reconnect → /api/auth/google?accountId=… (302 to
 *     Google consent)
 *   - Disconnect          → /api/auth/google/disconnect
 *
 * Email shown is the address that authed the OAuth grant; not
 * necessarily the same as the REOS sign-in email.
 */

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plug,
  Unplug,
} from "lucide-react";
import { useToast } from "@/app/ToastProvider";

type Status =
  | { state: "loading" }
  | { state: "connected"; email: string | null }
  | { state: "disconnected"; reason?: string };

export function GoogleConnectionPanel({
  accountId,
  hasStoredBlob,
}: {
  accountId: string;
  hasStoredBlob: boolean;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [busy, setBusy] = useState<"disconnect" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/google/status");
        const data = await res.json();
        if (cancelled) return;
        if (data.connected) {
          setStatus({ state: "connected", email: data.email ?? null });
        } else {
          setStatus({ state: "disconnected", reason: data.error });
        }
      } catch {
        if (!cancelled) setStatus({ state: "disconnected" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function reconnect() {
    // Hard navigation — the route 302s to Google's consent screen.
    window.location.href = `/api/auth/google?accountId=${encodeURIComponent(accountId)}`;
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect Google? Inbox scans, calendar sync, and the morning brief will stop until you reconnect.",
      )
    )
      return;
    setBusy("disconnect");
    try {
      const res = await fetch("/api/auth/google/disconnect", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "disconnect failed");
      toast.success("Disconnected", "Google access has been revoked.");
      setStatus({ state: "disconnected" });
    } catch (e) {
      toast.error(
        "Disconnect failed",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold">
          Google account
        </h2>
        <span className="text-xs text-text-muted">
          Powers inbox scans, calendar sync, contract auto-extraction
        </span>
      </header>

      {status.state === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking connection…
        </div>
      ) : status.state === "connected" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2
              className="h-5 w-5 shrink-0 text-emerald-500"
              strokeWidth={1.8}
            />
            <div>
              <div className="text-sm font-medium text-text">Connected</div>
              <div className="text-xs text-text-muted">
                {status.email ?? "(email unknown)"}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reconnect}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-brand-500"
            >
              <Plug className="h-3.5 w-3.5" strokeWidth={2} />
              Reconnect
            </button>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy === "disconnect"}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-danger hover:text-danger disabled:opacity-50"
            >
              {busy === "disconnect" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unplug className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-accent-600"
              strokeWidth={1.8}
            />
            <div>
              <div className="text-sm font-medium text-text">
                Not connected
              </div>
              <div className="text-xs text-text-muted">
                {hasStoredBlob && status.reason
                  ? `Stored token rejected by Google: ${status.reason}. Reconnect to refresh.`
                  : hasStoredBlob
                    ? "Stored token expired. Reconnect to refresh."
                    : "Connect Gmail + Calendar so REOS can scan, build timelines, and send invites."}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={reconnect}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
          >
            <Plug className="h-3.5 w-3.5" strokeWidth={2} />
            {hasStoredBlob ? "Reconnect Google" : "Connect Google"}
          </button>
        </div>
      )}
    </section>
  );
}
