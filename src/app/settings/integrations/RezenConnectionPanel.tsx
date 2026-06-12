"use client";

/**
 * Rezen / Real Broker connection card. Owner enters their Real
 * username + password once; REOS signs in to keymaker, stores the
 * resulting JWT encrypted, and uses it to push documents into Rezen
 * checklists. Password is never stored.
 */

import { useEffect, useState } from "react";
import { Loader2, Link2, Unplug } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function RezenConnectionPanel() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    try {
      const res = await fetch("/api/integrations/rezen/status");
      const b = (await res.json()) as { connected?: boolean; email?: string | null };
      setConnected(!!b.connected);
      setEmail(b.email ?? null);
    } catch {
      /* leave defaults */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadStatus();
  }, []);

  async function connect() {
    if (!user.trim() || !pass) {
      toast.error("Missing credentials", "Enter your Real username/email and password.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/rezen/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usernameOrEmail: user.trim(), password: pass }),
      });
      const b = (await res.json()) as { ok?: boolean; email?: string; error?: string };
      if (!res.ok || !b.ok) {
        toast.error("Couldn't connect Real", b.error ?? res.statusText);
        return;
      }
      toast.success("Real connected", b.email ?? undefined);
      setPass("");
      await loadStatus();
    } catch (e) {
      toast.error("Connect errored", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/integrations/rezen/connect", { method: "DELETE" });
      toast.success("Real disconnected");
      await loadStatus();
    } catch (e) {
      toast.error("Disconnect errored", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4 text-brand-600" strokeWidth={2} />
            Rezen (Real Broker)
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Connect your Real account to push compliance documents straight
            into your Rezen transaction checklists from REOS.
          </p>
        </div>
        {!loading && (
          <span
            className={
              "shrink-0 text-xs font-medium " +
              (connected ? "text-emerald-700" : "text-text-subtle")
            }
          >
            {connected ? "● Connected" : "○ Not connected"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
        </div>
      ) : connected ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-text-muted">
            Signed in{email ? ` as ${email}` : ""}.
          </span>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:border-red-300 hover:text-red-700 disabled:opacity-50"
          >
            <Unplug className="h-3.5 w-3.5" strokeWidth={2} />
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Real username or email"
            autoComplete="username"
            className="rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
          />
          <input
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Real password"
            type="password"
            autoComplete="current-password"
            className="rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
          />
          <div className="sm:col-span-2 flex items-center justify-between">
            <span className="text-[11px] text-text-subtle">
              We store the resulting token, never your password. MFA accounts
              aren&rsquo;t supported yet.
            </span>
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" strokeWidth={2} />}
              Connect Real
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
