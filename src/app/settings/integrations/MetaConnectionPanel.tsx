"use client";

/**
 * MetaConnectionPanel
 *
 * Mirrors GoogleConnectionPanel for the Facebook + Instagram OAuth
 * flow. Probes /api/auth/meta/status on mount, shows either the
 * connected-state row (FB email + list of Pages, each annotated with
 * its linked Instagram username when present) or the "Connect
 * Facebook" CTA.
 *
 * Surfaces ?meta=connected / ?meta=denied / ?meta=error query params
 * from the callback so the user gets feedback after the OAuth round-
 * trip.
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

interface ConnectedPage {
  id: string;
  name: string;
  instagram: { id?: string; username: string } | null;
}

type Status =
  | { state: "loading" }
  | { state: "connected"; email: string | null; pages: ConnectedPage[] }
  | { state: "disconnected"; reason?: string };

export function MetaConnectionPanel() {
  const toast = useToast();
  const params = useSearchParams();
  const banner = params.get("meta"); // connected | denied | error
  const expired = params.get("meta_error") === "expired";

  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [busy, setBusy] = useState<"disconnect" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/meta/status");
        const data = await res.json();
        if (cancelled) return;
        if (data.connected) {
          setStatus({
            state: "connected",
            email: data.email ?? null,
            pages: data.pages ?? [],
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
    window.location.href = "/api/auth/meta";
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect Meta? REOS will lose the ability to post to your Facebook Pages and Instagram Business accounts.",
      )
    )
      return;
    setBusy("disconnect");
    try {
      const res = await fetch("/api/auth/meta/disconnect", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "disconnect failed");
      toast.success("Disconnected", "Meta access has been revoked.");
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
          Facebook &amp; Instagram
        </h2>
        <span className="text-xs text-text-muted">
          Powers auto-posting to your FB Pages + IG Business accounts
        </span>
      </header>

      {banner === "connected" && (
        <Banner kind="success">
          Connected successfully. Pages and Instagram accounts shown below.
        </Banner>
      )}
      {banner === "denied" && (
        <Banner kind="warn">
          You declined the permission request. No data was stored.
        </Banner>
      )}
      {banner === "error" && (
        <Banner kind="error">
          Connection failed during the token exchange. Try again — if it
          keeps failing, check the Meta App is in Live mode.
        </Banner>
      )}
      {expired && (
        <Banner kind="warn">
          Sign-in took too long. The Meta consent flow timed out before you
          finished — click Connect Facebook below and complete the steps
          in one go.
        </Banner>
      )}

      {status.state === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking connection…
        </div>
      ) : status.state === "connected" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2
                className="h-4 w-4 text-emerald-600"
                strokeWidth={2}
              />
              <span className="text-sm">
                <span className="font-medium">Connected</span>
                {status.email && (
                  <span className="ml-1 text-text-muted">
                    as {status.email}
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

          {status.pages.length === 0 ? (
            <p className="rounded border border-dashed border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
              No Pages found on this account. To post to Facebook you need to
              be an admin of at least one Page. Add a Page in Facebook, then
              reconnect.
            </p>
          ) : (
            <div>
              <div className="reos-label mb-1">
                Pages granted to REOS
              </div>
              <ul className="space-y-1.5">
                {status.pages.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-text-muted">
                      {p.instagram ? (
                        <>
                          📷 IG: @{p.instagram.username}
                        </>
                      ) : (
                        <>No linked Instagram</>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <AlertCircle className="h-4 w-4" strokeWidth={2} /> Not connected.
            {status.reason && (
              <span className="text-xs">({status.reason})</span>
            )}
          </div>
          <button
            type="button"
            onClick={connect}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            <Plug className="h-3.5 w-3.5" strokeWidth={2} />
            Connect Facebook
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
    <div
      className={`mb-3 flex items-start gap-2 rounded border p-2.5 text-sm ${tone}`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
