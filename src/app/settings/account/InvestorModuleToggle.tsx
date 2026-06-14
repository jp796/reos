"use client";

/**
 * Owner-only toggle for the investor module entitlement (spec §1).
 * Adds/removes "investor" from the account's entitlements; retail_tc
 * is always preserved server-side. When on, investor surfaces (the
 * Retail/Investment/All lens, strategy templates, etc.) light up.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes } from "lucide-react";

export function InvestorModuleToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setErr(null);
    // Optimistic — revert on failure.
    setEnabled(next);
    try {
      const res = await fetch("/api/account/entitlements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investor: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnabled(!next);
        setErr(data.message ?? data.error ?? res.statusText);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setEnabled(!next);
      setErr(e instanceof Error ? e.message : "update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
            <Boxes className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold">Investor module</h2>
            <p className="mt-1 text-sm text-text-muted">
              Adds investor deal management on top of your retail TC tools —
              flip / wholesale / rental strategies, the Asset board, and the
              Retail / Investment / All lens. Your existing transactions are
              unaffected.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={busy}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? "bg-brand-600" : "bg-surface-2 ring-1 ring-border"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      <div className="mt-3 text-xs">
        <span className={enabled ? "text-emerald-700" : "text-text-subtle"}>
          {enabled ? "● Enabled" : "○ Disabled"}
        </span>
        {err && <span className="ml-3 text-red-600">{err}</span>}
      </div>
    </section>
  );
}
