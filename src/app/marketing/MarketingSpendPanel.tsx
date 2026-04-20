"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Source {
  id: string;
  name: string;
  category: string;
}
interface Spend {
  id: string;
  spendDate: string;
  amount: number;
  notes: string | null;
  sourceChannelId: string;
  sourceName: string;
  sourceCategory: string;
}

const CATEGORIES = [
  "paid",
  "organic",
  "referral",
  "sphere",
  "direct_mail",
  "youtube",
  "ppc",
  "portal",
  "open_house",
  "repeat_client",
  "other",
];

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MarketingSpendPanel({
  initialSpends,
  initialSources,
}: {
  initialSpends: Spend[];
  initialSources: Source[];
}) {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [spends, setSpends] = useState<Spend[]>(initialSpends);
  const [, startTransition] = useTransition();

  // Add-spend form state
  const [sourceId, setSourceId] = useState<string>(initialSources[0]?.id ?? "");
  const [spendDate, setSpendDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Add-source form state
  const [showNewSource, setShowNewSource] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("paid");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceErr, setSourceErr] = useState<string | null>(null);

  const totalByYear = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of spends) {
      const yr = new Date(s.spendDate).getFullYear();
      map.set(yr, (map.get(yr) ?? 0) + s.amount);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [spends]);

  async function addSpend(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceId || !spendDate || !amount) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/marketing/spends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceChannelId: sourceId,
          spendDate,
          amount: Number(amount),
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      // Optimistic add
      const source = sources.find((s) => s.id === sourceId);
      setSpends((prev) =>
        [
          {
            id: data.id,
            spendDate: new Date(spendDate).toISOString(),
            amount: Number(amount),
            notes: notes.trim() || null,
            sourceChannelId: sourceId,
            sourceName: source?.name ?? "—",
            sourceCategory: source?.category ?? "other",
          },
          ...prev,
        ].sort((a, b) => b.spendDate.localeCompare(a.spendDate)),
      );
      setAmount("");
      setNotes("");
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function addSource(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSourceBusy(true);
    setSourceErr(null);
    try {
      const res = await fetch("/api/marketing/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), category: newCategory }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSourceErr(data.error ?? res.statusText);
        return;
      }
      const created: Source = {
        id: data.id,
        name: newName.trim(),
        category: newCategory,
      };
      if (data.created) {
        setSources((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      setSourceId(data.id);
      setNewName("");
      setNewCategory("paid");
      setShowNewSource(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setSourceErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSourceBusy(false);
    }
  }

  async function deleteSpend(id: string) {
    if (!window.confirm("Delete this spend entry?")) return;
    try {
      const res = await fetch(`/api/marketing/spends/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setSpends((prev) => prev.filter((s) => s.id !== id));
      startTransition(() => router.refresh());
    } catch {
      // ignore
    }
  }

  return (
    <>
      {/* YTD tiles */}
      {totalByYear.length > 0 && (
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {totalByYear.slice(0, 4).map(([yr, tot]) => (
            <div
              key={yr}
              className="rounded-md border border-border bg-surface p-3"
            >
              <div className="text-xs uppercase tracking-wide text-text-muted">
                {yr}
              </div>
              <div className="mt-0.5 text-xl font-semibold">{fmtMoney(tot)}</div>
            </div>
          ))}
        </section>
      )}

      {/* Add form */}
      <section className="mb-8 rounded-md border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium">Add spend entry</h2>
        <form
          onSubmit={addSpend}
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_140px_auto]"
        >
          <div>
            <label className="mb-1 block text-xs text-text-muted">
              Source
            </label>
            <div className="flex gap-2">
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="flex-1 rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
                required
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.category})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewSource((v) => !v)}
                className="rounded border border-border-strong bg-surface px-2 py-1 text-xs hover:border-border-strong"
                title="Add a new source channel"
              >
                + New
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">Date</label>
            <input
              type="date"
              value={spendDate}
              onChange={(e) => setSpendDate(e.target.value)}
              className="w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">
              Amount ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="250.00"
              className="w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
              required
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50 sm:w-auto"
            >
              {saving ? "Saving…" : "Add"}
            </button>
          </div>
          <div className="sm:col-span-4">
            <label className="mb-1 block text-xs text-text-muted">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Campaign name, date range, anything useful"
              className="w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
            />
          </div>
          {err && (
            <div className="text-xs text-red-600 sm:col-span-4">{err}</div>
          )}
        </form>

        {showNewSource && (
          <form
            onSubmit={addSource}
            className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_180px_auto]"
          >
            <div>
              <label className="mb-1 block text-xs text-text-muted">
                New source name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder='e.g. "Fast Expert" or "Mailchimp Q1"'
                className="w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">
                Category
              </label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={sourceBusy}
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:border-border-strong disabled:opacity-50 sm:w-auto"
              >
                {sourceBusy ? "Adding…" : "Add source"}
              </button>
            </div>
            {sourceErr && (
              <div className="text-xs text-red-600 sm:col-span-3">
                {sourceErr}
              </div>
            )}
          </form>
        )}
      </section>

      {/* Entries table */}
      <section className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Notes</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {spends.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-text-muted"
                >
                  No entries yet. Add your first spend above to light up
                  CAC/ROI on the Sources dashboard.
                </td>
              </tr>
            )}
            {spends.map((s) => (
              <tr
                key={s.id}
                className="border-b border-neutral-100 last:border-0"
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  {fmtDate(s.spendDate)}
                </td>
                <td className="px-4 py-2">
                  <span className="font-medium">{s.sourceName}</span>
                  <span className="ml-2 text-xs text-text-muted">
                    ({s.sourceCategory})
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  {fmtMoney(s.amount)}
                </td>
                <td className="px-4 py-2 text-text-muted">
                  {s.notes ?? "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => deleteSpend(s.id)}
                    className="text-xs text-text-muted hover:text-red-600"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
