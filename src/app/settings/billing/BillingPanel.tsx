"use client";

import { useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import type { Tier } from "@/lib/stripe";

const PLANS: Array<{
  tier: Exclude<Tier, "free">;
  name: string;
  pitch: string;
  bullets: string[];
}> = [
  {
    tier: "solo",
    name: "Solo",
    pitch: "One agent. Every workflow.",
    bullets: [
      "Unlimited transactions",
      "AI contract extraction",
      "Voice intake + Telegram brief",
      "Listing photos + social posts",
    ],
  },
  {
    tier: "team",
    name: "Team",
    pitch: "Up to 5 agents under one TC.",
    bullets: [
      "Everything in Solo",
      "Multi-user roles + sharing",
      "Calendar share-list",
      "Transaction handoff",
    ],
  },
  {
    tier: "brokerage",
    name: "Brokerage",
    pitch: "Whole brokerage on one workspace.",
    bullets: [
      "Everything in Team",
      "Custom checklist (Vision-parsed)",
      "Multi-tenant accounts",
      "Priority support",
    ],
  },
];

export function BillingPanel({
  tier,
  stripeReady,
}: {
  tier: Tier;
  stripeReady: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function subscribe(t: Exclude<Tier, "free">) {
    setBusy(t);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: t }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "checkout failed");
      }
      window.location.href = data.url;
    } catch (e) {
      toast.error("Checkout failed", e instanceof Error ? e.message : "unknown");
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "portal failed");
      }
      window.location.href = data.url;
    } catch (e) {
      toast.error("Portal failed", e instanceof Error ? e.message : "unknown");
      setBusy(null);
    }
  }

  const canPortal = stripeReady && tier !== "free";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = tier === p.tier;
          return (
            <div
              key={p.tier}
              className={`rounded-md border p-4 transition-colors ${
                isCurrent
                  ? "border-brand-500 bg-brand-50/40 dark:bg-brand-50/10"
                  : "border-border bg-surface"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                {isCurrent && (
                  <span className="text-[10px] uppercase tracking-wide text-brand-700">
                    Current
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-text-muted">{p.pitch}</p>
              <ul className="mt-3 space-y-1 text-xs text-text-muted">
                {p.bullets.map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
              <button
                type="button"
                disabled={!stripeReady || busy === p.tier || isCurrent}
                onClick={() => subscribe(p.tier)}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                {busy === p.tier && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {isCurrent
                  ? "Active"
                  : stripeReady
                    ? `Subscribe to ${p.name}`
                    : "Setup pending"}
              </button>
            </div>
          );
        })}
      </div>

      {canPortal && (
        <div className="rounded-md border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Manage subscription</div>
              <div className="text-xs text-text-muted">
                Update payment method, download invoices, or cancel.
              </div>
            </div>
            <button
              type="button"
              disabled={busy === "portal"}
              onClick={openPortal}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-brand-500"
            >
              {busy === "portal" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Open billing portal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
