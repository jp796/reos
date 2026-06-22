"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, Link2Off } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function RealKeyForm() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/integrations/real-key").then((r) => r.json());
      setConnected(!!r.connected);
      setAgentId(r.agentId ?? null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function connect() {
    if (!apiKey.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/integrations/real-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "connect failed");
      setApiKey("");
      toast.success("Real connected", "Commission data can now sync into financials.");
      load();
    } catch (e) {
      toast.error("Couldn't connect", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/integrations/real-key", { method: "DELETE" });
      setConnected(false);
      setAgentId(null);
      toast.success("Disconnected", "");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-text-muted">
        <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…
      </div>
    );
  }

  if (connected) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-text">
          <Check className="h-4 w-4 text-emerald-600" /> Real connected
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Agent <span className="font-mono">{agentId}</span>. On any deal&rsquo;s
          Financials, use <b>Pull from Real</b> to fill gross commission.
        </p>
        <button
          onClick={disconnect}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-muted hover:border-border-strong hover:text-text disabled:opacity-50"
        >
          <Link2Off className="h-3.5 w-3.5" /> Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-1 text-sm font-medium text-text">Connect Real (ReZEN) API key</div>
      <p className="mb-3 text-xs text-text-muted">
        Paste your Real API key (from your Real profile → API keys). It&rsquo;s
        stored encrypted and used read-only to pull commission/GCI into your deal
        financials.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="real_…"
          autoComplete="off"
          className="flex-1 rounded border border-border bg-surface-2 px-3 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
        />
        <button
          onClick={connect}
          disabled={busy || !apiKey.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Connect
        </button>
      </div>
    </div>
  );
}
