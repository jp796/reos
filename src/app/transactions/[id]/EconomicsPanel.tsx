"use client";

/**
 * EconomicsPanel — per-strategy deal economics for an investor Asset
 * (spec §9). Enter the inputs (purchase, rehab, sale, rents, etc.) and
 * the derived metrics (profit/ROI, cap rate/DSCR, spread, cash flow)
 * compute live using the exact same DealEconomicsService the Production
 * rollup uses. Saves the raw input bag to Asset.economicsJson.
 *
 * Renders only for principal deals; retail uses the FinancialsForm.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import {
  economicsFromBag,
  type DealEconomics,
} from "@/services/core/DealEconomicsService";
import type { Strategy } from "@/services/core/DealClassifierService";

type Field = { key: string; label: string; kind: "money" | "date" };

const FIELDS: Partial<Record<Strategy, Field[]>> = {
  flip: [
    { key: "purchasePrice", label: "Purchase price", kind: "money" },
    { key: "rehabBudget", label: "Rehab budget", kind: "money" },
    { key: "holdingCosts", label: "Holding costs", kind: "money" },
    { key: "buyingCosts", label: "Buying costs", kind: "money" },
    { key: "salePrice", label: "Sale price", kind: "money" },
    { key: "sellingCosts", label: "Selling costs", kind: "money" },
    { key: "purchaseDate", label: "Purchase date", kind: "date" },
    { key: "saleDate", label: "Sale date", kind: "date" },
  ],
  wholesale: [
    { key: "assignmentFee", label: "Assignment fee", kind: "money" },
    { key: "emd", label: "EMD", kind: "money" },
    { key: "contractDate", label: "Contract date", kind: "date" },
    { key: "assignedDate", label: "Assigned date", kind: "date" },
  ],
  rental_brrrr: [
    { key: "monthlyRent", label: "Monthly rent", kind: "money" },
    { key: "monthlyDebtService", label: "Debt service / mo", kind: "money" },
    { key: "monthlyTaxes", label: "Taxes / mo", kind: "money" },
    { key: "monthlyInsurance", label: "Insurance / mo", kind: "money" },
    { key: "monthlyMgmt", label: "Management / mo", kind: "money" },
    { key: "monthlyMaintenance", label: "Maintenance / mo", kind: "money" },
    { key: "allInCost", label: "All-in cost", kind: "money" },
    { key: "totalInvested", label: "Total invested", kind: "money" },
    { key: "cashOutRefi", label: "Cash-out at refi", kind: "money" },
  ],
  creative: [
    { key: "incomingMonthlyPayment", label: "Incoming pmt / mo", kind: "money" },
    { key: "underlyingMonthlyPayment", label: "Underlying pmt / mo", kind: "money" },
    { key: "monthlyExpenses", label: "Expenses / mo", kind: "money" },
    { key: "purchasePrice", label: "Purchase price", kind: "money" },
    { key: "entryCost", label: "Entry cost", kind: "money" },
    { key: "expectedExitValue", label: "Expected exit value", kind: "money" },
    { key: "balloonDate", label: "Balloon date", kind: "date" },
  ],
};

const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;

function metricRows(e: DealEconomics): Array<{ label: string; display: string; emph?: boolean }> {
  switch (e.kind) {
    case "flip":
      return [
        { label: "All-in cost", display: money(e.allInCost) },
        { label: "Projected profit", display: money(e.profit), emph: true },
        { label: "ROI", display: pct(e.roi) },
        { label: "Days to flip", display: e.daysToFlip != null ? `${e.daysToFlip}d` : "—" },
      ];
    case "wholesale":
      return [
        { label: "Spread", display: money(e.spread), emph: true },
        { label: "EMD exposure", display: money(e.emdExposure) },
        { label: "Days to assign", display: e.daysToAssign != null ? `${e.daysToAssign}d` : "—" },
      ];
    case "rental_brrrr":
      return [
        { label: "Cash flow / mo", display: money(e.monthlyCashFlow), emph: true },
        { label: "NOI (annual)", display: money(e.noiAnnual) },
        { label: "Cap rate", display: pct(e.capRate) },
        { label: "DSCR", display: e.dscr != null ? e.dscr.toFixed(2) : "—" },
        { label: "Capital left in", display: money(e.capitalLeftIn) },
      ];
    case "creative":
      return [
        { label: "Cash flow / mo", display: money(e.monthlyCashFlow), emph: true },
        { label: "Entry spread", display: money(e.entrySpread) },
        { label: "Exit spread", display: money(e.exitSpread) },
        { label: "Balloon horizon", display: e.balloonHorizonDays != null ? `${e.balloonHorizonDays}d` : "—" },
      ];
    default:
      return [];
  }
}

export function EconomicsPanel({
  assetId,
  strategy,
  initial,
}: {
  assetId: string;
  strategy: Strategy;
  initial: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const fields = FIELDS[strategy] ?? [];
  const [bag, setBag] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = initial?.[f.key];
      out[f.key] = v == null ? "" : String(v);
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  if (fields.length === 0) return null;

  const computed = economicsFromBag(strategy, bag);
  const rows = metricRows(computed);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${assetId}/economics`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bag),
      });
      if (!res.ok) {
        toast.error("Save failed", (await res.json()).error ?? res.statusText);
        return;
      }
      setDirty(false);
      toast.success("Economics saved", "Production P&L will reflect this deal.");
      router.refresh();
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-brand-700" strokeWidth={1.8} />
          <h2 className="text-sm font-medium">Deal economics</h2>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {busy ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 md:grid-cols-3">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="reos-label">{f.label}</span>
            <input
              type={f.kind === "date" ? "date" : "text"}
              inputMode={f.kind === "money" ? "decimal" : undefined}
              value={bag[f.key] ?? ""}
              onChange={(e) => {
                setBag({ ...bag, [f.key]: e.target.value });
                setDirty(true);
              }}
              placeholder={f.kind === "money" ? "0" : ""}
              className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
        ))}
      </div>

      {/* Live computed metrics */}
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-md border border-brand-200 bg-brand-50 p-3 dark:border-brand-900/40 dark:bg-brand-950/30 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="reos-label text-brand-700/80 dark:text-brand-300/80">
              {r.label}
            </div>
            <div
              className={`mt-0.5 tabular-nums ${r.emph ? "font-display text-display-sm font-semibold text-brand-700 dark:text-brand-200" : "text-sm text-text"}`}
            >
              {r.display}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        Updates live as you type. Save to feed this deal into the unified
        Production P&amp;L.
      </p>
    </section>
  );
}
