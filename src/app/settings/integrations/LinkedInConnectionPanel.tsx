"use client";

/**
 * LinkedInConnectionPanel
 *
 * Same shape as MetaConnectionPanel. Probes /api/auth/linkedin/status,
 * renders connected-state row (member name + email) or "Connect
 * LinkedIn" CTA. Surfaces ?linkedin=connected/denied/error banners
 * from the callback.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  | { state: "connected"; email: string | null; name: string | null }
  | { state: "disconnected"; reason?: string };

export function LinkedInConnectionPanel() {
  const toast = useToast();
  const params = useSearchParams();
  const banner = params.get("linkedin");
  const expired = params.get("linkedin_error") === "expired";

  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [busy, setBusy] = useState<"disconnect" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/linkedin/status");
        const data = await res.json();
        if (cancelled) return;
        if (data.connected) {
          setStatus({
            state: "connected",
            email: data.email ?? null,
            name: data.name ?? null,
          });
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

  function connect() {
    window.location.href = "/api/auth/linkedin";
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect LinkedIn? REOS will lose the ability to post to your LinkedIn feed.",
      )
    )
      return;
    setBusy("disconnect");
    try {
      const res = await fetch("/api/auth/linkedin/disconnect", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "disconnect failed");
      toast.success("Disconnected", "LinkedIn access has been cleared.");
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
        <h2 className="font-display text-base font-semibold">LinkedIn</h2>
        <span className="text-xs text-text-muted">
          Powers personal-feed posting (member share)
        </span>
      </header>

      {banner === "connected" && (
        <Banner kind="success">Connected — REOS can post to your LinkedIn feed.</Banner>
      )}
      {banner === "denied" && (
        <Banner kind="warn">You declined consent — no data was stored.</Banner>
      )}
      {banner === "error" && (
        <Banner kind="error">
          Connection failed during token exchange. Try again, or check your
          LinkedIn app is in Live mode for these scopes.
        </Banner>
      )}
      {expired && (
        <Banner kind="warn">
          Sign-in took too long and the CSRF window expired. Click Connect
          again.
        </Banner>
      )}

      {status.state === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking connection…
        </div>
      ) : status.state === "connected" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2
              className="h-4 w-4 text-emerald-600"
              strokeWidth={2}
            />
            <span>
              <span className="font-medium">Connected</span>
              {(status.name || status.email) && (
                <span className="ml-1 text-text-muted">
                  as {status.name ?? status.email}
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:border-red-400 hover:text-red-700 disabled:opacity-50"
          >
            <Unplug className="h-3 w-3" strokeWidth={2} />
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <AlertCircle className="h-4 w-4" strokeWidth={2} /> Not connected.
            {status.reason && <span className="text-xs">({status.reason})</span>}
          </div>
          <button
            type="button"
            onClick={connect}
            className="inline-flex items-center gap-1.5 rounded bg-[#0077B5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#006097]"
          >
            <Plug className="h-3.5 w-3.5" strokeWidth={2} />
            Connect LinkedIn
          </button>
        </div>
      )}
    </section>
  );
}

function Banner({
  kind,
  children,
}: {
  kind: "success" | "warn" | "error";
  children: React.ReactNode;
}) {
  const tone =
    kind === "success"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : kind === "error"
        ? "border-red-300 bg-red-50 text-red-900"
        : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`mb-3 flex items-start gap-2 rounded border p-2.5 text-sm ${tone}`}>
      <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
