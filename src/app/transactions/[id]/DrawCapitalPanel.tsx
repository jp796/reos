"use client";

/**
 * DrawCapitalPanel — rehab draws + capital stack for an investor Asset
 * (spec §7). Renders only for principal deals. Draws enforce the
 * lien-waiver gate server-side; the UI reflects status and surfaces the
 * blocked reason. Capital stack tracks funding sources + nearest balloon.
 */

import { useEffect, useState, useCallback } from "react";
import { Landmark, HardHat, Plus, Trash2, AlertTriangle } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Draw {
  id: string;
  milestone: string;
  amount: number;
  status: string;
  lienWaiverDocId: string | null;
  retainageHeld: number | null;
}
interface Schedule {
  id: string;
  retainagePercent: number;
  status?: string;
  draws: Draw[];
}
interface CapEntry {
  id: string;
  type: string;
  principal: number | null;
  rate: number | null;
  balloonDate: string | null;
  payoffBalance: number | null;
  lender: { id: string; fullName: string } | null;
}

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const CAP_TYPES = [
  ["private_money", "Private money"],
  ["bridge", "Bridge"],
  ["dscr", "DSCR"],
  ["seller_note", "Seller note"],
  ["underlying_loan", "Underlying loan (sub-to)"],
] as const;

export function DrawCapitalPanel({ assetId }: { assetId: string }) {
  const toast = useToast();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [entries, setEntries] = useState<CapEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // draw form
  const [milestone, setMilestone] = useState("");
  const [amount, setAmount] = useState("");
  // capital form
  const [capType, setCapType] = useState<string>("private_money");
  const [capPrincipal, setCapPrincipal] = useState("");
  const [capRate, setCapRate] = useState("");
  const [capBalloon, setCapBalloon] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        fetch(`/api/assets/${assetId}/draws`).then((r) => r.json()),
        fetch(`/api/assets/${assetId}/capital`).then((r) => r.json()),
      ]);
      setSchedule(d.schedule ?? null);
      setEntries(c.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addDraw() {
    const amt = parseFloat(amount);
    if (!milestone.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast.error("Draw needs", "a milestone and a positive amount");
      return;
    }
    const res = await fetch(`/api/assets/${assetId}/draws`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ milestone, amount: amt }),
    });
    if (!res.ok) {
      toast.error("Add draw failed", (await res.json()).message ?? res.statusText);
      return;
    }
    setMilestone("");
    setAmount("");
    void load();
  }

  async function drawAction(drawId: string, action: string, extra?: Record<string, unknown>) {
    const res = await fetch(`/api/assets/${assetId}/draws/${drawId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.reason === "lien_waiver_required") {
        toast.error("Blocked", "Attach a lien waiver before releasing this draw.");
      } else if (data.reason === "not_verified") {
        toast.error("Blocked", "Verify the draw (photos) before releasing.");
      } else {
        toast.error("Action failed", data.reason ?? data.error ?? res.statusText);
      }
      return;
    }
    if (action === "release") {
      toast.success("Released", `Net ${money(data.net)} · retainage held ${money(data.retainageHeld)}`);
    }
    void load();
  }

  async function addCapital() {
    const res = await fetch(`/api/assets/${assetId}/capital`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: capType,
        principal: capPrincipal ? parseFloat(capPrincipal) : null,
        rate: capRate ? parseFloat(capRate) : null,
        balloonDate: capBalloon || null,
      }),
    });
    if (!res.ok) {
      toast.error("Add failed", (await res.json()).message ?? res.statusText);
      return;
    }
    setCapPrincipal("");
    setCapRate("");
    setCapBalloon("");
    void load();
  }

  async function deleteCapital(entryId: string) {
    const res = await fetch(`/api/assets/${assetId}/capital?entryId=${entryId}`, {
      method: "DELETE",
    });
    if (res.ok) void load();
  }

  const draws = schedule?.draws ?? [];
  const totalDrawn = draws.filter((d) => d.status === "released" || d.status === "paid").reduce((s, d) => s + d.amount, 0);
  const totalRetainage = draws.reduce((s, d) => s + (d.retainageHeld ?? 0), 0);
  const totalPrincipal = entries.reduce((s, e) => s + (e.principal ?? 0), 0);
  const balloons = entries
    .filter((e) => e.balloonDate)
    .map((e) => new Date(e.balloonDate as string))
    .sort((a, b) => a.getTime() - b.getTime());
  const nearestBalloon = balloons[0] ?? null;
  const balloonSoon =
    nearestBalloon && nearestBalloon.getTime() - Date.now() < 90 * 86_400_000;

  return (
    <section className="mt-8 space-y-4">
      {/* Draws */}
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardHat className="h-4 w-4 text-brand-700" strokeWidth={1.8} />
            <h2 className="text-sm font-medium">Rehab draws</h2>
          </div>
          <div className="text-xs text-text-muted">
            Released {money(totalDrawn)} · retainage held{" "}
            <span className="font-medium text-text">{money(totalRetainage)}</span>
            {schedule ? ` · ${schedule.retainagePercent}% retainage` : ""}
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-text-muted">Loading…</p>
        ) : draws.length === 0 ? (
          <p className="text-xs text-text-muted">No draws yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {draws.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-text">{d.milestone}</span>
                  <span className="ml-2 tabular-nums">{money(d.amount)}</span>
                  <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-text-muted">{d.status}</span>
                  {d.lienWaiverDocId && <span className="ml-1 text-emerald-700">· lien waiver ✓</span>}
                  {d.retainageHeld ? <span className="ml-1 text-text-muted">· held {money(d.retainageHeld)}</span> : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {d.status === "requested" && (
                    <button onClick={() => drawAction(d.id, "verify")} className="rounded border border-border px-2 py-0.5 hover:border-brand-500">Verify</button>
                  )}
                  {d.status !== "released" && d.status !== "paid" && !d.lienWaiverDocId && (
                    <button
                      onClick={() => {
                        const docId = window.prompt("Lien-waiver document id / ref:");
                        if (docId) drawAction(d.id, "lien_waiver", { docId });
                      }}
                      className="rounded border border-border px-2 py-0.5 hover:border-brand-500"
                    >
                      + Lien waiver
                    </button>
                  )}
                  {d.status === "verified" && (
                    <button onClick={() => drawAction(d.id, "release")} className="rounded bg-brand-600 px-2 py-0.5 font-medium text-white hover:bg-brand-500">Release</button>
                  )}
                  {d.status === "released" && (
                    <button onClick={() => drawAction(d.id, "pay")} className="rounded border border-border px-2 py-0.5 hover:border-brand-500">Mark paid</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={milestone} onChange={(e) => setMilestone(e.target.value)} placeholder="Milestone (e.g. rough-in)" className="flex-1 rounded border border-border bg-surface-2 px-2 py-1 text-xs" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal" className="w-28 rounded border border-border bg-surface-2 px-2 py-1 text-xs tabular-nums" />
          <button onClick={addDraw} className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500">
            <Plus className="h-3 w-3" strokeWidth={2} /> Request draw
          </button>
        </div>
        {draws.some((d) => d.retainageHeld) && schedule?.status !== "complete" && (
          <button
            onClick={() => drawAction(draws[0].id, "release_retainage")}
            className="mt-2 text-xs text-text-muted underline hover:text-brand-700"
          >
            Release retainage at punch-list ({money(totalRetainage)})
          </button>
        )}
      </div>

      {/* Capital stack */}
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-brand-700" strokeWidth={1.8} />
            <h2 className="text-sm font-medium">Capital stack</h2>
          </div>
          <div className="text-xs text-text-muted">
            Total principal{" "}
            <span className="font-medium text-text">{money(totalPrincipal)}</span>
          </div>
        </div>

        {balloonSoon && nearestBalloon && (
          <div className="mb-2 flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
            <AlertTriangle className="h-3 w-3" strokeWidth={2} />
            Balloon due {nearestBalloon.toLocaleDateString("en-US")} — fund the exit.
          </div>
        )}

        {entries.length > 0 && (
          <ul className="mb-3 divide-y divide-border rounded border border-border">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 p-2.5 text-xs">
                <div>
                  <span className="font-medium text-text">{CAP_TYPES.find((t) => t[0] === e.type)?.[1] ?? e.type}</span>
                  {e.principal != null && <span className="ml-2 tabular-nums">{money(e.principal)}</span>}
                  {e.rate != null && <span className="ml-2 text-text-muted">{e.rate}%</span>}
                  {e.balloonDate && <span className="ml-2 text-text-muted">balloon {new Date(e.balloonDate).toLocaleDateString("en-US")}</span>}
                  {e.lender && <span className="ml-2 text-text-muted">· {e.lender.fullName}</span>}
                </div>
                <button onClick={() => deleteCapital(e.id)} className="text-text-subtle hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select value={capType} onChange={(e) => setCapType(e.target.value)} className="rounded border border-border bg-surface-2 px-2 py-1 text-xs">
            {CAP_TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <input value={capPrincipal} onChange={(e) => setCapPrincipal(e.target.value)} placeholder="Principal" inputMode="decimal" className="w-28 rounded border border-border bg-surface-2 px-2 py-1 text-xs tabular-nums" />
          <input value={capRate} onChange={(e) => setCapRate(e.target.value)} placeholder="Rate %" inputMode="decimal" className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-xs tabular-nums" />
          <input type="date" value={capBalloon} onChange={(e) => setCapBalloon(e.target.value)} className="rounded border border-border bg-surface-2 px-2 py-1 text-xs" />
          <button onClick={addCapital} className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500">
            <Plus className="h-3 w-3" strokeWidth={2} /> Add
          </button>
        </div>
      </div>
    </section>
  );
}
