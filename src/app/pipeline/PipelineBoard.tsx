"use client";

/**
 * PipelineBoard — the interactive $ Pipeline table. Renders merged auto+manual
 * income rows with live totals, filters, and CRUD on manual lines. Auto lines
 * (derived from deal commissions) are read-only and badged "from deal".
 */

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, Check, DollarSign, Link2 } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import type { PipelineRow, PipelineTotals } from "@/services/core/PipelineService";

const DISPOSITIONS = [
  "Wholesale",
  "Flip Sale",
  "Client Purchase",
  "Client Sale",
  "Rental Portfolio Sale",
  "Other",
];
const BUSINESSES = ["EPS", "RE Agent"];

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

interface Deal {
  id: string;
  address: string;
}

interface Draft {
  business: string;
  property: string;
  disposition: string;
  expectedIncome: string;
  expectedDate: string;
  status: "contracted" | "guess";
  note: string;
  transactionId: string;
}

const emptyDraft: Draft = {
  business: "EPS",
  property: "",
  disposition: "Wholesale",
  expectedIncome: "",
  expectedDate: "",
  status: "guess",
  note: "",
  transactionId: "",
};

export function PipelineBoard({
  initialRows,
  initialTotals,
  deals,
}: {
  initialRows: PipelineRow[];
  initialTotals: PipelineTotals;
  deals: Deal[];
}) {
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [totals, setTotals] = useState(initialTotals);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [bizFilter, setBizFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  async function refresh() {
    const res = await fetch("/api/pipeline", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { rows: PipelineRow[]; totals: PipelineTotals };
      setRows(data.rows);
      setTotals(data.totals);
    }
  }

  function startAdd() {
    setDraft(emptyDraft);
    setEditingId(null);
    setAdding(true);
  }

  function startEdit(r: PipelineRow) {
    setDraft({
      business: r.business,
      property: r.property,
      disposition: r.disposition,
      expectedIncome: String(r.expectedIncome),
      expectedDate: toDateInput(r.expectedDate),
      status: r.status,
      note: r.note ?? "",
      transactionId: r.transactionId ?? "",
    });
    setAdding(false);
    setEditingId(r.id);
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function draftPayload() {
    const amount = Number(draft.expectedIncome.replace(/[^0-9.-]/g, ""));
    return {
      business: draft.business.trim() || "EPS",
      property: draft.property.trim(),
      disposition: draft.disposition,
      expectedIncome: Number.isFinite(amount) ? amount : 0,
      expectedDate: draft.expectedDate ? new Date(draft.expectedDate).toISOString() : null,
      status: draft.status,
      note: draft.note.trim() || null,
      transactionId: draft.transactionId || null,
    };
  }

  async function saveNew() {
    const payload = draftPayload();
    if (!payload.property) {
      toast.error("Property is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error("Couldn't add line", (await res.json().catch(() => null))?.error);
        return;
      }
      toast.success("Income line added");
      cancel();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const payload = draftPayload();
    if (!payload.property) {
      toast.error("Property is required");
      return;
    }
    setBusy(true);
    try {
      const { transactionId: _drop, ...body } = payload;
      const res = await fetch(`/api/pipeline/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error("Couldn't save", (await res.json().catch(() => null))?.error);
        return;
      }
      toast.success("Line updated");
      cancel();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: PipelineRow) {
    if (r.source !== "manual") return;
    if (!confirm(`Remove "${r.property}" (${usd(r.expectedIncome)}) from the pipeline?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pipeline/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't remove line");
        return;
      }
      toast.success("Line removed");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (bizFilter === "all" || r.business === bizFilter) &&
          (statusFilter === "all" || r.status === statusFilter),
      ),
    [rows, bizFilter, statusFilter],
  );

  const visibleTotal = useMemo(
    () => visible.reduce((s, r) => s + r.expectedIncome, 0),
    [visible],
  );

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-display-lg font-semibold">
            <DollarSign className="h-6 w-6 text-brand-600" strokeWidth={2} />$ Pipeline
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Expected income across the business — live from your deals, plus anything you add by hand.
          </p>
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" strokeWidth={2.2} /> Add income line
        </button>
      </div>

      {/* Totals */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TotalCard label="Total pipeline" value={usd(totals.grandTotal)} accent />
        <TotalCard label="Contracted" value={usd(totals.contractedTotal)} sub="firm / under contract" />
        <TotalCard label="Projected (guess)" value={usd(totals.guessTotal)} sub="not yet firm" />
        <TotalCard label="Lines" value={String(totals.count)} sub="income items" />
      </div>

      {totals.byBusiness.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {totals.byBusiness.map((b) => (
            <span
              key={b.business}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text-muted"
            >
              {b.business}
              <span className="font-semibold text-text">{usd(b.total)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Add form */}
      {adding && (
        <LineForm
          draft={draft}
          setDraft={setDraft}
          deals={deals}
          busy={busy}
          allowLink
          onSave={saveNew}
          onCancel={cancel}
        />
      )}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <Filter label="Business" value={bizFilter} onChange={setBizFilter} options={["all", ...BUSINESSES]} />
        <Filter
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={["all", "contracted", "guess"]}
        />
        {(bizFilter !== "all" || statusFilter !== "all") && (
          <span className="text-text-muted">
            Showing <span className="font-semibold text-text">{usd(visibleTotal)}</span> across {visible.length} lines
          </span>
        )}
      </div>

      {/* Table */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-text-subtle">
              <th className="px-3 py-2.5 font-medium">Business</th>
              <th className="px-3 py-2.5 font-medium">Property</th>
              <th className="px-3 py-2.5 font-medium">Disposition</th>
              <th className="px-3 py-2.5 text-right font-medium">Expected income</th>
              <th className="px-3 py-2.5 font-medium">Date</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-text-muted">
                  No income lines yet. Add one, or populate deal financials to see auto lines.
                </td>
              </tr>
            )}
            {visible.map((r) =>
              editingId === r.id ? (
                <tr key={r.id} className="border-b border-border bg-brand-50/30">
                  <td colSpan={7} className="p-0">
                    <LineForm
                      draft={draft}
                      setDraft={setDraft}
                      deals={deals}
                      busy={busy}
                      onSave={() => saveEdit(r.id)}
                      onCancel={cancel}
                      inline
                    />
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface/60">
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-text-muted">
                      {r.business}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-text">
                    <span className="flex items-center gap-1.5">
                      {r.property}
                      {r.source === "auto" && (
                        <span
                          title="Auto-derived from this deal's commission"
                          className="inline-flex items-center gap-0.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-100"
                        >
                          <Link2 className="h-2.5 w-2.5" /> from deal
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-text-muted">{r.disposition}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-text">
                    {usd(r.expectedIncome)}
                  </td>
                  <td className="px-3 py-2.5 text-text-muted tabular-nums">{fmtDate(r.expectedDate)}</td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.source === "manual" ? (
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-brand-700"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          disabled={busy}
                          className="rounded p-1 text-text-muted hover:bg-red-50 hover:text-red-600"
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-subtle">live</span>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TotalCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-brand-200 bg-brand-50/50" : "border-border bg-surface"}`}>
      <div className="reos-label text-text-subtle">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold tabular-nums ${accent ? "text-brand-700" : "text-text"}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-text-subtle">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: "contracted" | "guess" }) {
  return status === "contracted" ? (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300">
      Contracted
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-300">
      Guess
    </span>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-text-muted">
      {label}:
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "all" ? "All" : o.charAt(0).toUpperCase() + o.slice(1)}
          </option>
        ))}
      </select>
    </label>
  );
}

function LineForm({
  draft,
  setDraft,
  deals,
  busy,
  onSave,
  onCancel,
  allowLink,
  inline,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  deals: Deal[];
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  allowLink?: boolean;
  inline?: boolean;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  return (
    <div className={`${inline ? "" : "mt-4 rounded-xl border border-brand-200 bg-brand-50/30"} p-4`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Property">
          <input
            value={draft.property}
            onChange={(e) => set({ property: e.target.value })}
            placeholder="1520 E Cherokee"
            className="reos-input"
            autoFocus
          />
        </Field>
        <Field label="Business">
          <select value={draft.business} onChange={(e) => set({ business: e.target.value })} className="reos-input">
            {BUSINESSES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
        <Field label="Disposition">
          <select value={draft.disposition} onChange={(e) => set({ disposition: e.target.value })} className="reos-input">
            {DISPOSITIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Expected income ($)">
          <input
            value={draft.expectedIncome}
            onChange={(e) => set({ expectedIncome: e.target.value })}
            inputMode="decimal"
            placeholder="14000"
            className="reos-input"
          />
        </Field>
        <Field label="Expected date">
          <input
            type="date"
            value={draft.expectedDate}
            onChange={(e) => set({ expectedDate: e.target.value })}
            className="reos-input"
          />
        </Field>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={(e) => set({ status: e.target.value as "contracted" | "guess" })}
            className="reos-input"
          >
            <option value="guess">Guess</option>
            <option value="contracted">Contracted</option>
          </select>
        </Field>
        {allowLink && (
          <Field label="Link to deal (optional — hides its auto line)">
            <select
              value={draft.transactionId}
              onChange={(e) => set({ transactionId: e.target.value })}
              className="reos-input"
            >
              <option value="">— none —</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.address}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Note (optional)">
          <input
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="e.g. referral, off-market"
            className="reos-input"
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <Check className="h-4 w-4" /> Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-muted hover:text-text"
        >
          <X className="h-4 w-4" /> Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="reos-label mb-1 block text-text-subtle">{label}</span>
      {children}
    </label>
  );
}
