"use client";

/**
 * DealTypeControl — the front door to the investor module (spec §1, §5).
 * Inline strategy + representation editor on the deal page. Picking an
 * investor strategy flips the Asset to principal and (because the page
 * re-renders) lights up the stage board, draws, capital stack, and
 * investor risk. Backed by the tested PATCH /api/assets/[id] endpoint.
 *
 * Only renders when the account holds the investor entitlement.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Check } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

// Strategy → representation + default title path. Picking a strategy
// sets the whole classification in one move (retail = agency).
const STRATEGIES: Array<{
  value: string;
  label: string;
  representation: "agency" | "principal";
  titlePath: string | null;
}> = [
  { value: "retail", label: "Retail (agency)", representation: "agency", titlePath: "takes_title" },
  { value: "flip", label: "Flip", representation: "principal", titlePath: "takes_title" },
  { value: "wholesale", label: "Wholesale", representation: "principal", titlePath: "assignment" },
  { value: "rental_brrrr", label: "Rental / BRRRR", representation: "principal", titlePath: "takes_title" },
  { value: "creative", label: "Creative finance", representation: "principal", titlePath: "takes_title" },
];

export function DealTypeControl({
  assetId,
  strategy,
}: {
  assetId: string;
  strategy: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(strategy);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function change(next: string) {
    if (next === value) return;
    const def = STRATEGIES.find((s) => s.value === next);
    if (!def) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy: def.value,
          representation: def.representation,
          titlePath: def.titlePath,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setValue(prev);
        toast.error("Couldn't change deal type", data.error ?? res.statusText);
        return;
      }
      toast.success(
        "Deal type updated",
        def.representation === "principal"
          ? `${def.label} — investor tools are now on this deal`
          : def.label,
      );
      // Re-render so the investor panels mount/unmount for the new type.
      startTransition(() => router.refresh());
    } catch (e) {
      setValue(prev);
      toast.error("Couldn't change deal type", e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  const isInvestor =
    STRATEGIES.find((s) => s.value === value)?.representation === "principal";

  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5">
      <Boxes
        className={`h-3.5 w-3.5 ${isInvestor ? "text-brand-700" : "text-text-muted"}`}
        strokeWidth={1.8}
      />
      <span className="reos-label">Deal type</span>
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={busy}
        className="rounded border border-border bg-surface-2 px-2 py-1 text-xs font-medium disabled:opacity-50"
      >
        {STRATEGIES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {busy && <span className="text-xs text-text-muted">Saving…</span>}
      {!busy && isInvestor && (
        <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700">
          <Check className="h-3 w-3" strokeWidth={2.5} /> investor
        </span>
      )}
    </div>
  );
}
