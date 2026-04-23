"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoneyInput } from "@/app/components/MoneyInput";

interface Financials {
  salePrice?: number | null;
  commissionPercent?: number | null;
  grossCommission?: number | null;
  referralFeeAmount?: number | null;
  brokerageSplitAmount?: number | null;
  marketingCostAllocated?: number | null;
  netCommission?: number | null;
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Label the commission % field based on the transaction's
 * representation. Seller-only deals collect the seller-side rate
 * (typically 2.5-3%). Buyer-only collect the buyer-side rate.
 * Dual agency collects the COMBINED rate (buy + sell, typically 5-6%). */
function commissionLabel(side?: string | null): string {
  switch (side) {
    case "buy":
      return "Buyer-side %";
    case "sell":
      return "Seller-side %";
    case "both":
      return "Combined % (dual)";
    default:
      return "Commission %";
  }
}

export function FinancialsForm({
  transactionId,
  initial,
  side,
}: {
  transactionId: string;
  initial: Financials | null;
  /** Representation — "buy" | "sell" | "both" | null. Drives how the
   * commission % is interpreted:
   *   - buy/sell  → the single-side rate we collect (e.g. 2.5%)
   *   - both      → the combined rate for dual agency (e.g. 5-6%)
   *   - null      → unset; behave like a single side for now */
  side?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const [salePrice, setSalePrice] = useState(
    initial?.salePrice?.toString() ?? "",
  );
  // Commission % as user enters it — "2.5" means 2.5%, NOT 0.025.
  // Stored in DB as the same human-readable %  (commissionPercent field).
  const [commissionPercent, setCommissionPercent] = useState(
    initial?.commissionPercent?.toString() ?? "",
  );
  const [grossCommission, setGrossCommission] = useState(
    initial?.grossCommission?.toString() ?? "",
  );
  // Track whether GCI was manually overridden vs. auto-computed — so the
  // user's manual value doesn't get blown away when they later edit the %
  const [gciManual, setGciManual] = useState(
    !!(
      initial?.grossCommission &&
      initial?.commissionPercent &&
      initial?.salePrice &&
      // "manual" = stored GCI doesn't equal price × pct / 100 ±$1
      Math.abs(
        initial.grossCommission -
          (initial.salePrice * initial.commissionPercent) / 100,
      ) > 1
    ),
  );
  const [referralFeeAmount, setReferralFeeAmount] = useState(
    initial?.referralFeeAmount?.toString() ?? "",
  );
  const [brokerageSplitAmount, setBrokerageSplitAmount] = useState(
    initial?.brokerageSplitAmount?.toString() ?? "",
  );
  const [marketingCostAllocated, setMarketingCostAllocated] = useState(
    initial?.marketingCostAllocated?.toString() ?? "",
  );

  // Derived — auto GCI from price × pct when GCI isn't manually overridden
  const priceNum = parseFloat(salePrice || "0");
  const pctNum = parseFloat(commissionPercent || "0");
  const autoGci =
    priceNum > 0 && pctNum > 0 ? Math.round(priceNum * pctNum) / 100 : 0;

  const effectiveGciStr =
    gciManual && grossCommission !== ""
      ? grossCommission
      : autoGci > 0
        ? String(autoGci)
        : grossCommission;

  const gross = parseFloat(effectiveGciStr || "0");
  const ref = parseFloat(referralFeeAmount || "0");
  const split = parseFloat(brokerageSplitAmount || "0");
  const mkt = parseFloat(marketingCostAllocated || "0");
  const hasGross = effectiveGciStr !== "" && !Number.isNaN(gross) && gross > 0;
  const netPreview = hasGross ? gross - ref - split - mkt : null;

  async function save() {
    setBusy(true);
    setMsg(null);
    setIsError(false);
    try {
      // Save the EFFECTIVE GCI (auto if not manually overridden) so that
      // downstream consumers (Production dashboard, Sources ROI) see the
      // right number without having to re-compute.
      const gciToSave = hasGross ? gross : null;
      const res = await fetch(`/api/transactions/${transactionId}/financials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salePrice: salePrice === "" ? null : parseFloat(salePrice),
          commissionPercent:
            commissionPercent === "" ? null : parseFloat(commissionPercent),
          grossCommission: gciToSave,
          referralFeeAmount:
            referralFeeAmount === "" ? null : parseFloat(referralFeeAmount),
          brokerageSplitAmount:
            brokerageSplitAmount === "" ? null : parseFloat(brokerageSplitAmount),
          marketingCostAllocated:
            marketingCostAllocated === ""
              ? null
              : parseFloat(marketingCostAllocated),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error ?? res.statusText);
        return;
      }
      setMsg("Saved");
      setEditing(false);
      startTransition(() => router.refresh());
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setIsError(true);
      setMsg(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  if (!editing) {
    const sideLabel =
      side === "buy"
        ? "Buyer"
        : side === "sell"
          ? "Seller"
          : side === "both"
            ? "Dual"
            : null;
    return (
      <section className="mt-8">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-medium">Financials</h2>
            {sideLabel && (
              <span className="text-xs text-text-muted">
                Representation:{" "}
                <span className="font-medium text-text">{sideLabel}</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-text-muted hover:text-text"
          >
            {initial ? "Edit" : "Add"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-border bg-surface p-4 md:grid-cols-4">
          <Field label="Sale price" value={fmtMoney(initial?.salePrice)} />
          <Field
            label={commissionLabel(side)}
            value={
              initial?.commissionPercent != null
                ? `${initial.commissionPercent}%`
                : "—"
            }
          />
          <Field label="GCI" value={fmtMoney(initial?.grossCommission)} />
          <Field
            label="Referral fee"
            value={fmtMoney(initial?.referralFeeAmount)}
          />
          <Field
            label="Brokerage split"
            value={fmtMoney(initial?.brokerageSplitAmount)}
          />
          <Field
            label="Marketing cost"
            value={fmtMoney(initial?.marketingCostAllocated)}
          />
          <Field
            label="Net commission"
            value={fmtMoney(initial?.netCommission)}
            emphasis
          />
        </div>
        {msg && (
          <div
            className={`mt-2 text-xs ${isError ? "text-red-600" : "text-emerald-700"}`}
          >
            {msg}
          </div>
        )}
      </section>
    );
  }

  const isDual = side === "both";
  const repLabel =
    side === "buy"
      ? "Buyer"
      : side === "sell"
        ? "Seller"
        : side === "both"
          ? "Dual"
          : null;

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-medium">Financials · editing</h2>
        {repLabel && (
          <span className="text-xs text-text-muted">
            Representation:{" "}
            <span className="font-medium text-text">{repLabel}</span>
          </span>
        )}
      </div>
      <div className="rounded-md border border-border bg-surface p-4">
        {isDual && (
          <div className="mb-3 rounded-md border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-700">
            <strong>Dual agency.</strong> Enter the COMBINED commission %
            (buy side + sell side) since we&rsquo;re earning both halves.
            GCI auto-computes as <span className="tabular-nums">sale price × combined %</span>.
          </div>
        )}
        {/* Row 1: Sale Price · Commission % · GCI (auto) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MoneyInput
            label="Sale price"
            value={salePrice}
            onChange={setSalePrice}
            disabled={disabled}
          />
          <label className="block">
            <span className="reos-label">{commissionLabel(side)}</span>
            <div className="relative mt-1">
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={commissionPercent}
                onChange={(e) => {
                  setCommissionPercent(e.target.value);
                  // Re-compute GCI from % unless user has explicitly overridden
                  if (!gciManual) setGrossCommission("");
                }}
                disabled={disabled}
                placeholder="2.5"
                className="w-full rounded border border-border bg-surface-2 py-1.5 pl-2 pr-6 text-sm tabular-nums disabled:opacity-50"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-text-muted">
                %
              </span>
            </div>
          </label>
          <div>
            <MoneyInput
              label={`GCI${gciManual ? "" : " (auto)"}`}
              value={effectiveGciStr}
              onChange={(v) => {
                setGrossCommission(v);
                setGciManual(true);
              }}
              disabled={disabled}
            />
            {gciManual && autoGci > 0 && (
              <button
                type="button"
                onClick={() => {
                  setGciManual(false);
                  setGrossCommission("");
                }}
                className="mt-1 text-[11px] text-text-muted hover:text-brand-700"
              >
                ← Reset to auto ({fmtMoney(autoGci)})
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Deductions */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <MoneyInput
            label="Referral fee"
            value={referralFeeAmount}
            onChange={setReferralFeeAmount}
            disabled={disabled}
          />
          <MoneyInput
            label="Brokerage split"
            value={brokerageSplitAmount}
            onChange={setBrokerageSplitAmount}
            disabled={disabled}
          />
          <MoneyInput
            label="Marketing cost allocated"
            value={marketingCostAllocated}
            onChange={setMarketingCostAllocated}
            disabled={disabled}
          />
        </div>

        {/* Row 3: Net (read-only, always computed) */}
        <div className="mt-4 rounded-md border border-brand-200 bg-brand-50 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="reos-label text-brand-700/80">
                Net commission · auto
              </div>
              <div className="mt-1 font-display text-display-md font-semibold text-brand-700 tabular-nums">
                {netPreview === null ? "—" : fmtMoney(netPreview)}
              </div>
              {netPreview !== null && (
                <div className="mt-1 text-[11px] text-brand-700/70 tabular-nums">
                  {fmtMoney(gross)} − {fmtMoney(ref)} − {fmtMoney(split)} −{" "}
                  {fmtMoney(mkt)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={disabled}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={disabled}
            className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          {msg && (
            <span className={`text-xs ${isError ? "text-red-600" : "text-emerald-700"}`}>
              {msg}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div
        className={`mt-0.5 ${emphasis ? "text-base font-semibold text-emerald-800" : "text-sm"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm disabled:opacity-50"
      />
    </label>
  );
}
