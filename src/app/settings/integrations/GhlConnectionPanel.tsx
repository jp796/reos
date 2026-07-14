"use client";

/**
 * Connect GoHighLevel (LeadConnector) so REOS can pull motivated-seller
 * contact info onto investment deals. Uses a Private Integration token
 * (Settings → Private Integrations in GHL) + the location id.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/ToastProvider";

export function GhlConnectionPanel({
  connected,
  locationId,
}: {
  connected: boolean;
  locationId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [token, setToken] = useState("");
  const [loc, setLoc] = useState(locationId ?? "");
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (!token.trim() || !loc.trim()) {
      toast.error("Missing info", "Paste your GHL token and location id.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/ghl/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim(), locationId: loc.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Couldn't connect", data.error ?? res.statusText);
        return;
      }
      toast.success("GoHighLevel connected", "Seller intel can now be pulled on investment deals.");
      setToken("");
      router.refresh();
    } catch (e) {
      toast.error("Connect failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/integrations/ghl/connect", { method: "DELETE" });
      toast.success("GoHighLevel disconnected");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">GoHighLevel (seller CRM)</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Pull motivated-seller phones, emails, and situation onto investment deals.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
            connected
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-surface-2 text-text-subtle ring-border"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {connected ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-text-muted">
            Location <span className="font-mono">{locationId}</span>
          </span>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:border-red-300 hover:text-red-700 disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="GHL Private Integration token (pit-…)"
            className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
          <input
            type="text"
            value={loc}
            onChange={(e) => setLoc(e.target.value)}
            placeholder="Location id (Settings → Business Profile in GHL)"
            className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm font-mono"
          />
          <div className="flex items-center justify-between">
            <a
              href="https://help.gohighlevel.com/support/solutions/articles/155000003054-private-integrations"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-700 hover:underline"
            >
              How to create a Private Integration token →
            </a>
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
