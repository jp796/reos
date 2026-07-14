"use client";

/**
 * FlipCalculator — the interactive analyzer. Holds the full FlipInputs set,
 * recomputes all four scenarios live via computeFlip (no server round-trip),
 * and can save a run attached to a deal.
 */

import { useMemo, useState } from "react";
import { Calculator, Save, Home, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import {
  computeFlip,
  DEFAULT_FLIP_INPUTS,
  type FlipInputs,
  type Comp,
  type CommissionType,
  type RehabChoice,
} from "@/services/core/FlipCalcModel";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  );
const money2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0,
  );

interface Deal {
  id: string;
  address: string;
}

export function FlipCalculator({
  deals,
  prefillDealId,
  prefillAddress,
}: {
  deals: Deal[];
  prefillDealId: string | null;
  prefillAddress: string;
}) {
  const toast = useToast();
  const [address, setAddress] = useState(prefillAddress);
  const [inputs, setInputs] = useState<FlipInputs>(DEFAULT_FLIP_INPUTS);
  const [dealId, setDealId] = useState<string>(prefillDealId ?? "");
  const [saving, setSaving] = useState(false);

  const r = useMemo(() => computeFlip(inputs), [inputs]);
  const set = (patch: Partial<FlipInputs>) => setInputs((prev) => ({ ...prev, ...patch }));

  function setComp(idx: number, patch: Partial<Comp>) {
    const next = [...inputs.flipComps];
    const current: Comp = next[idx] ?? { salePrice: 0, sqft: 0 };
    next[idx] = { ...current, ...patch };
    set({ flipComps: next });
  }
  function addComp() {
    if (inputs.flipComps.length >= 5) return;
    set({ flipComps: [...inputs.flipComps, { salePrice: 0, sqft: 0 }] });
  }
  function removeComp(idx: number) {
    set({ flipComps: inputs.flipComps.filter((_, i) => i !== idx) });
  }

  async function save() {
    if (!address.trim()) {
      toast.error("Add a property address to save");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/flip-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: address.trim(),
          inputs: { ...inputs, address: address.trim() },
          transactionId: dealId || null,
        }),
      });
      if (!res.ok) {
        toast.error("Couldn't save", (await res.json().catch(() => null))?.error);
        return;
      }
      toast.success("Analysis saved", dealId ? "Attached to the deal." : "Saved to your account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-display-lg font-semibold">
            <Calculator className="h-6 w-6 text-brand-600" strokeWidth={2} />
            Flip Calculator
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Analyze any property across four exit strategies. Everything recalculates as you type.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            className="reos-input max-w-[220px]"
            title="Attach this analysis to a deal"
          >
            <option value="">Not attached to a deal</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.address}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save analysis"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ---------- INPUTS ---------- */}
        <div className="space-y-4">
          <Card title="Property & purchase" icon={<Home className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Property address" full>
                <input value={address} onChange={(e) => setAddress(e.target.value)} className="reos-input" placeholder="2315 Thomes Ave" />
              </Field>
              <Num label="Square feet" value={inputs.sqft} onChange={(v) => set({ sqft: v })} />
              <Num label="Offer price" value={inputs.offerPrice} onChange={(v) => set({ offerPrice: v })} money />
              <Num label="Wholesaler fee" value={inputs.wholesalerFee} onChange={(v) => set({ wholesalerFee: v })} money />
              <Num label="Title fee %" value={inputs.titleFeePct} onChange={(v) => set({ titleFeePct: v })} pct />
            </div>
          </Card>

          <Card title="Annual carry & commissions">
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label="Property tax (annual)" value={inputs.propertyTaxAnnual} onChange={(v) => set({ propertyTaxAnnual: v })} money />
              <Num label="Insurance (annual)" value={inputs.insuranceAnnual} onChange={(v) => set({ insuranceAnnual: v })} money />
              <Num label="Utilities (annual)" value={inputs.utilitiesAnnual} onChange={(v) => set({ utilitiesAnnual: v })} money />
              <Num label="Other (annual)" value={inputs.otherAnnual} onChange={(v) => set({ otherAnnual: v })} money />
              <Num label="Listing commission %" value={inputs.commListingPct} onChange={(v) => set({ commListingPct: v })} pct />
              <Num label="Buyer commission %" value={inputs.commBuyerPct} onChange={(v) => set({ commBuyerPct: v })} pct />
              <Field label="Commission type">
                <select
                  value={inputs.commissionType}
                  onChange={(e) => set({ commissionType: e.target.value as CommissionType })}
                  className="reos-input"
                >
                  <option value="None">None</option>
                  <option value="Seller Agent">Seller Agent</option>
                  <option value="Referral Agent">Referral Agent</option>
                </select>
              </Field>
            </div>
            <p className="mt-2 text-[11px] text-text-subtle">Closing costs (auto): {money(r.closingCostsAuto)} — offer × title fee.</p>
          </Card>

          <Card title="Comps → ARV">
            <p className="mb-2 text-xs text-text-muted">
              Add up to 5 flip comps. Average $/sqft × square feet sets the Fix &amp; Flip ARV.
            </p>
            <div className="space-y-2">
              {inputs.flipComps.map((c, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    className="reos-input"
                    placeholder="Sale price"
                    inputMode="decimal"
                    value={c.salePrice || ""}
                    onChange={(e) => setComp(idx, { salePrice: num(e.target.value) })}
                  />
                  <input
                    className="reos-input"
                    placeholder="SqFt"
                    inputMode="decimal"
                    value={c.sqft || ""}
                    onChange={(e) => setComp(idx, { sqft: num(e.target.value) })}
                  />
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-text-muted">
                    {c.sqft > 0 ? money2(c.salePrice / c.sqft) : "—"}/sf
                  </span>
                  <button type="button" onClick={() => removeComp(idx)} className="rounded p-1 text-text-muted hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {inputs.flipComps.length < 5 && (
              <button type="button" onClick={addComp} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <Plus className="h-3.5 w-3.5" /> Add comp
              </button>
            )}
            <div className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm">
              Avg $/sqft: <b className="tabular-nums">{money2(r.comps.avgPricePerSqft)}</b> · ARV:{" "}
              <b className="tabular-nums text-brand-700">{money(r.fixFlip.arv)}</b>
            </div>
          </Card>

          <Card title="Rehab & financing">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rehab choice">
                <select
                  value={inputs.rehabChoice}
                  onChange={(e) => set({ rehabChoice: e.target.value as RehabChoice })}
                  className="reos-input"
                >
                  <option>Light Rehab Estimate</option>
                  <option>Medium Rehab Estimate</option>
                  <option>Big Rehab Estimate</option>
                </select>
              </Field>
              <Num label="Flip rehab budget" value={inputs.flipRehabBudget} onChange={(v) => set({ flipRehabBudget: v })} money />
              <Num label="Holding time (months)" value={inputs.flipHoldingMonths} onChange={(v) => set({ flipHoldingMonths: v })} />
              <Num label="Interest rate %" value={inputs.flipInterestRate} onChange={(v) => set({ flipInterestRate: v })} pct />
              <Num label="Points %" value={inputs.flipPointsPct} onChange={(v) => set({ flipPointsPct: v })} pct />
              <Num label="My split %" value={inputs.fluellenPct} onChange={(v) => set({ fluellenPct: v })} pct />
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-subtle">
              <span>Light {money(r.rehab.light)}</span>
              <span>Medium {money(r.rehab.medium)}</span>
              <span>Big {money(r.rehab.big)}</span>
              <span className="font-medium text-text-muted">Chosen {money(r.rehab.chosen)}</span>
            </div>
          </Card>

          <Card title="Other scenarios (inputs)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label="Wholetail ARV" value={inputs.wholetailARV} onChange={(v) => set({ wholetailARV: v })} money />
              <Num label="Wholetail rehab" value={inputs.wholetailRehabBudget} onChange={(v) => set({ wholetailRehabBudget: v })} money />
              <Num label="Rental ARV" value={inputs.rentalARV} onChange={(v) => set({ rentalARV: v })} money />
              <Num label="Rent (monthly)" value={inputs.rentMonthly} onChange={(v) => set({ rentMonthly: v })} money />
              <Num label="Rental insurance (mo)" value={inputs.rentalInsuranceMonthly} onChange={(v) => set({ rentalInsuranceMonthly: v })} money />
              <Num label="Rental tax (annual)" value={inputs.rentalPropertyTaxAnnual} onChange={(v) => set({ rentalPropertyTaxAnnual: v })} money />
              <Num label="Owner-finance market value" value={inputs.ofMarketValue} onChange={(v) => set({ ofMarketValue: v })} money />
              <Num label="Owner-finance rehab" value={inputs.ofRehabBudget} onChange={(v) => set({ ofRehabBudget: v })} money />
            </div>
          </Card>
        </div>

        {/* ---------- RESULTS ---------- */}
        <div className="space-y-4">
          <Scenario
            title="Fix & Flip"
            profit={r.fixFlip.profit}
            rows={[
              ["ARV", money(r.fixFlip.arv)],
              ["Total expenses", money(r.fixFlip.totalExpenses)],
              ["Max offer · $50k profit", money(r.fixFlip.maxOfferForProfit)],
              ["Max offer · 70% LTV", money(r.fixFlip.maxOffer70Ltv)],
              ["Break-even offer", money(r.fixFlip.breakEvenOffer)],
              ["Interest / points", `${money(r.fixFlip.interest)} / ${money(r.fixFlip.points)}`],
              ["My split", money(r.fixFlip.fluellen)],
              ["Extra realtor $", money(r.fixFlip.extraRealtor)],
            ]}
          />
          <Scenario
            title="Wholetail"
            profit={r.wholetail.profit}
            rows={[
              ["ARV (manual)", money(r.wholetail.arv)],
              ["Total expenses", money(r.wholetail.totalExpenses)],
              ["Max offer · $30k profit", money(r.wholetail.maxOfferForProfit)],
              ["Max offer · 70% LTV", money(r.wholetail.maxOffer70Ltv)],
              ["Break-even offer", money(r.wholetail.breakEvenOffer)],
              ["My split", money(r.wholetail.fluellen)],
            ]}
          />
          <Scenario
            title="DSCR Rental (3-yr)"
            profit={r.rental.totalProfit3yr}
            profitLabel="Total profit (3 yr)"
            rows={[
              ["Loan (70% ARV)", money(r.rental.loanAmount)],
              ["Monthly P&I", money(r.rental.monthlyPI)],
              ["Monthly cashflow", money(r.rental.monthlyCashflow)],
              ["Annual depreciation", money(r.rental.annualDepreciation)],
              ["Appreciation (3 yr)", money(r.rental.appreciation3yr)],
              ["Principal paydown (3 yr)", money(r.rental.principalPaydown3yr)],
              ["CoC return (annualized)", pctText(r.rental.cocReturnAnnualized)],
            ]}
          />
          <Scenario
            title="Owner Finance (3-yr payday)"
            profit={r.ownerFinance.totalProfit3yr}
            profitLabel="Total profit (3 yr)"
            rows={[
              ["Down payment (20%)", money(r.ownerFinance.downPayment)],
              ["Buyer mortgage (mo)", money(r.ownerFinance.buyerMortgageMonthly)],
              ["My loan / P&I", `${money(r.ownerFinance.myLoanAmount)} / ${money(r.ownerFinance.myMonthlyPI)}`],
              ["Monthly cashflow", money(r.ownerFinance.monthlyCashflow)],
              ["Initial cash/profit", money(r.ownerFinance.initialCashProfit)],
              ["3-yr cashflow", money(r.ownerFinance.cashflowTotal3yr)],
              ["Final payoff profit", money(r.ownerFinance.finalPayoffProfit)],
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function num(s: string): number {
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pctText(fraction: number): string {
  return `${(Number.isFinite(fraction) ? fraction * 100 : 0).toFixed(1)}%`;
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-text">
        {icon && <span className="text-text-muted">{icon}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="reos-label mb-1 block text-text-subtle">{label}</span>
      {children}
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  money: isMoney,
  pct,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  money?: boolean;
  pct?: boolean;
}) {
  const display = pct ? (value * 100).toString() : value ? value.toString() : "";
  return (
    <Field label={pct ? `${label}` : label}>
      <div className="relative">
        {isMoney && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-text-subtle">$</span>}
        <input
          className={`reos-input ${isMoney ? "pl-6" : ""} ${pct ? "pr-6" : ""}`}
          inputMode="decimal"
          value={display}
          onChange={(e) => {
            const raw = num(e.target.value);
            onChange(pct ? raw / 100 : raw);
          }}
        />
        {pct && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-text-subtle">%</span>}
      </div>
    </Field>
  );
}

function Scenario({
  title,
  profit,
  profitLabel = "Profit",
  rows,
}: {
  title: string;
  profit: number;
  profitLabel?: string;
  rows: Array<[string, string]>;
}) {
  const positive = profit >= 0;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="font-display text-sm font-semibold text-text">{title}</h3>
        <div className="text-right">
          <div className="reos-label text-text-subtle">{profitLabel}</div>
          <div className={`font-display text-xl font-semibold tabular-nums ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {money(profit)}
          </div>
        </div>
      </div>
      <dl className="divide-y divide-border/60">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
            <dt className="text-text-muted">{k}</dt>
            <dd className="tabular-nums font-medium text-text">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
