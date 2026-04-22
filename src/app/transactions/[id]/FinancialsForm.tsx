"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoneyInput } from "@/app/components/MoneyInput";

interface Financials {
  salePrice?: number | null;
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

export function FinancialsForm({
  transactionId,
  initial,
}: {
  transactionId: string;
  initial: Financials | null;
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
  const [grossCommission, setGrossCommission] = useState(
    initial?.grossCommission?.toString() ?? "",
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

  // Live-computed preview
  const gross = parseFloat(grossCommission || "0");
  const ref = parseFloat(referralFeeAmount || "0");
  const split = parseFloat(brokerageSplitAmount || "0");
  const mkt = parseFloat(marketingCostAllocated || "0");
  const netPreview =
    grossCommission === "" || Number.isNaN(gross)
      ? null
      : gross - ref - split - mkt;

  async function save() {
    setBusy(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/financials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salePrice: salePrice === "" ? null : parseFloat(salePrice),
          grossCommission:
            grossCommission === "" ? null : parseFloat(grossCommission),
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
    return (
      <section className="mt-8">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Financials</h2>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-text-muted hover:text-text"
          >
            {initial ? "Edit" : "Add"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-border bg-surface p-4 md:grid-cols-3">
          <Field label="Sale price" value={fmtMoney(initial?.salePrice)} />
          <Field
            label="Gross commission"
            value={fmtMoney(initial?.grossCommission)}
          />
          <Field label="Referral fee" value={fmtMoney(initial?.referralFeeAmount)} />
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

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-medium">Financials · editing</h2>
      </div>
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MoneyInput
            label="Sale price"
            value={salePrice}
            onChange={setSalePrice}
            disabled={disabled}
          />
          <MoneyInput
            label="Gross commission"
            value={grossCommission}
            onChange={setGrossCommission}
            disabled={disabled}
          />
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
          <div className="flex items-end">
            <div>
              <div className="text-xs uppercase tracking-wide text-text-muted">
                Net commission (preview)
              </div>
              <div className="mt-0.5 text-lg font-semibold text-emerald-800">
                {netPreview === null ? "—" : fmtMoney(netPreview)}
              </div>
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
