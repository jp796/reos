"use client";

/**
 * Inline 3-segment toggle for transaction representation:
 * Buyer / Seller / Dual.
 *
 * Lives in the transaction header so the agent can flip it in one
 * click without opening the edit form. Saves via PATCH /edit which
 * also syncs transactionType when it's in {buyer, seller, ""}.
 * Investor / wholesale / other values for transactionType are
 * preserved — we only touch the rep-oriented columns.
 *
 * The selected rep drives:
 *   - FinancialsForm labeling (single side vs combined) and the
 *     interpretation of commission% when computing GCI
 *   - /transactions list filter tabs (Buyer / Seller / Dual)
 *   - /api/transactions/:id/contract/rescan default side
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { useToast } from "@/app/ToastProvider";

type Rep = "buy" | "sell" | "both";

const OPTIONS: Array<{ value: Rep; label: string }> = [
  { value: "buy", label: "Buyer" },
  { value: "sell", label: "Seller" },
  { value: "both", label: "Dual" },
];

export function RepresentationToggle({
  transactionId,
  side,
  transactionType,
}: {
  transactionId: string;
  side: string | null;
  transactionType: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState<Rep | "">(
    side === "buy" || side === "sell" || side === "both" ? side : "",
  );
  const [pending, startTransition] = useTransition();

  async function change(next: Rep) {
    if (next === value) return;
    const prev = value;
    setValue(next); // optimistic

    // Auto-sync transactionType only when it's already rep-oriented or
    // empty — don't stomp investor / wholesale / other.
    const syncType =
      transactionType === "buyer" ||
      transactionType === "seller" ||
      transactionType === "";
    const nextType =
      next === "buy"
        ? "buyer"
        : next === "sell"
          ? "seller"
          : transactionType; // "both" leaves type alone

    startTransition(async () => {
      try {
        const res = await fetch(`/api/transactions/${transactionId}/edit`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            side: next,
            ...(syncType ? { transactionType: nextType } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setValue(prev);
          toast.error("Couldn't flip rep", data.error ?? res.statusText);
          return;
        }
        const label =
          next === "buy" ? "Buyer" : next === "sell" ? "Seller" : "Dual";
        toast.success(
          `Representation: ${label}`,
          "Financials + filters updated.",
        );
        router.refresh();
      } catch (e) {
        setValue(prev);
        toast.error(
          "Couldn't flip rep",
          e instanceof Error ? e.message : "unknown error",
        );
      }
    });
  }

  return (
    <div
      role="group"
      aria-label="Representation"
      className="inline-flex overflow-hidden rounded-md border border-border bg-surface"
    >
      {OPTIONS.map((opt, i) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => change(opt.value)}
            disabled={pending}
            className={cn(
              "px-2.5 py-1 text-xs font-medium transition-colors",
              i > 0 && "border-l border-border",
              active
                ? "bg-accent-100 text-accent-700"
                : "text-text-muted hover:bg-surface-2 hover:text-text",
              pending && "opacity-70",
            )}
            title={`Represent the ${opt.label.toLowerCase()}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
