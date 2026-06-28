"use client";

/**
 * DealBoard — Monday.com-style grouped board for transactions.
 *
 * Rows grouped by status; each group has a colored bar + count. The
 * Status column is an inline editable colored pill (click → pick a new
 * status → persists via PATCH /api/transactions/[id]/status and the row
 * animates to its new group). Clean REOS-blue skin.
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Check, LayoutGrid, List } from "lucide-react";

export interface BoardRow {
  id: string;
  address: string;
  status: string;
  closingDate: string | null;
  owner: string | null;
  salePrice: number | null;
  gci: number | null;
}

interface StatusDef {
  id: string;
  label: string;
  bar: string;
  pill: string;
}

// Group order + colors. Unknown statuses fall into "Active".
const STATUSES: StatusDef[] = [
  { id: "listing", label: "Listing", bar: "bg-brand-500", pill: "bg-brand-50 text-brand-700 ring-brand-100 dark:bg-brand-950/40 dark:text-brand-200" },
  { id: "active", label: "Active", bar: "bg-green-500", pill: "bg-green-50 text-green-700 ring-green-100 dark:bg-green-950/40 dark:text-green-300" },
  { id: "pending", label: "Pending", bar: "bg-amber-500", pill: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-300" },
  { id: "closed", label: "Closed", bar: "bg-accent-500", pill: "bg-accent-50 text-accent-700 ring-accent-100" },
  { id: "dead", label: "Dead", bar: "bg-gray-400", pill: "bg-surface-2 text-text-muted ring-border" },
];
const defOf = (s: string) => STATUSES.find((x) => x.id === s) ?? STATUSES[1];

const usd = (n: number | null) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function DealBoard({ initial }: { initial: BoardRow[] }) {
  const [rows, setRows] = useState<BoardRow[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);

  async function changeStatus(id: string, next: string) {
    setOpenId(null);
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: next } : r)));
    try {
      const res = await fetch(`/api/transactions/${id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          next === "closed"
            ? { status: next, closingDate: new Date().toISOString().slice(0, 10) }
            : { status: next },
        ),
      });
      if (!res.ok) setRows(prev);
    } catch {
      setRows(prev);
    }
  }

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-display-lg font-semibold">Deal Board</h1>
          <p className="mt-1 text-sm text-text-muted">
            Every deal, grouped by status. Click a status to move it.
          </p>
        </div>
        <Link
          href="/transactions"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:border-border-strong hover:text-text"
        >
          <List className="h-4 w-4" /> List view
        </Link>
      </div>

      <div className="mt-6 space-y-6">
        {STATUSES.map((st) => {
          const group = rows.filter((r) => defOf(r.status).id === st.id);
          if (group.length === 0) return null;
          return (
            <section key={st.id} className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center gap-2.5 border-b border-border bg-surface px-3 py-2.5">
                <span className={`h-4 w-1 rounded-full ${st.bar}`} />
                <span className="text-sm font-semibold text-text">{st.label}</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
                  {group.length}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/50 text-left">
                      <th className="reos-label px-3 py-2 font-medium">Deal</th>
                      <th className="reos-label px-3 py-2 font-medium">Status</th>
                      <th className="reos-label px-3 py-2 font-medium">Owner</th>
                      <th className="reos-label px-3 py-2 font-medium">Close date</th>
                      <th className="reos-label px-3 py-2 text-right font-medium">Sale price</th>
                      <th className="reos-label px-3 py-2 text-right font-medium">GCI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((r) => {
                      const d = defOf(r.status);
                      return (
                        <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2/40">
                          <td className="px-3 py-2.5">
                            <Link href={`/transactions/${r.id}`} className="font-medium text-text hover:text-brand-600">
                              {r.address}
                            </Link>
                          </td>
                          <td className="relative px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => setOpenId(openId === r.id ? null : r.id)}
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${d.pill}`}
                            >
                              {d.label}
                              <ChevronDown className="h-3 w-3 opacity-60" />
                            </button>
                            {openId === r.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setOpenId(null)} />
                                <div className="absolute left-3 top-full z-20 mt-1 w-40 rounded-lg border border-border bg-surface p-1 shadow-lg">
                                  {STATUSES.map((opt) => (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onClick={() => changeStatus(r.id, opt.id)}
                                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                                    >
                                      <span className={`h-2.5 w-2.5 rounded-full ${opt.bar}`} />
                                      <span className="flex-1 text-text">{opt.label}</span>
                                      {opt.id === r.status && <Check className="h-3.5 w-3.5 text-brand-600" />}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-text-muted">{r.owner ?? "—"}</td>
                          <td className="px-3 py-2.5 text-text-muted">{fmtDate(r.closingDate)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-text">{usd(r.salePrice)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-text">{usd(r.gci)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-10 text-center text-sm text-text-muted">
            <LayoutGrid className="mx-auto mb-2 h-6 w-6 text-text-subtle" />
            No deals yet.
          </div>
        )}
      </div>
    </div>
  );
}
