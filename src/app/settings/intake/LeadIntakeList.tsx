"use client";

/**
 * LeadIntakeList — per-row status controls (promote / contacted /
 * dismiss) with live filter tabs. History-preserving — dismissed
 * leads hide from the default view but stay queryable.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, MessageCircle, Archive, ExternalLink } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import { cn } from "@/lib/cn";

interface Lead {
  id: string;
  side: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  propertyAddress: string | null;
  areaOfInterest: string | null;
  budget: string | null;
  timeline: string | null;
  financingStatus: string | null;
  source: string | null;
  notes: string | null;
  status: string;
  submittedAt: string;
  convertedTransactionId: string | null;
}

type StatusFilter = "new" | "contacted" | "converted" | "dismissed" | "all";

const FILTER_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "converted", label: "Converted" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LeadIntakeList({ initial }: { initial: Lead[] }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<StatusFilter>("new");
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { new: 0, contacted: 0, converted: 0, dismissed: 0 };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);

  async function setStatus(id: string, status: string) {
    const prev = items.find((i) => i.id === id);
    if (!prev) return;
    setItems((cur) =>
      cur.map((i) => (i.id === id ? { ...i, status } : i)),
    );
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success(`Marked ${status}`);
      startTransition(() => router.refresh());
    } catch (e) {
      setItems((cur) => cur.map((i) => (i.id === id ? prev : i)));
      toast.error("Update failed", e instanceof Error ? e.message : "unknown");
    }
  }

  async function promote(id: string) {
    try {
      const res = await fetch(`/api/leads/${id}/promote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success(
        data.alreadyConverted ? "Already converted" : "Promoted",
        `Contact + transaction created`,
      );
      setItems((cur) =>
        cur.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "converted",
                convertedTransactionId: data.transactionId,
              }
            : i,
        ),
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Promote failed", e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_TABS.map((tab) => {
          const count =
            tab.id === "all" ? items.length : counts[tab.id] ?? 0;
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text",
              )}
            >
              {tab.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
          No leads in this view.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((l) => (
            <li
              key={l.id}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">{l.fullName}</span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        l.side === "buy"
                          ? "bg-brand-50 text-brand-700"
                          : "bg-accent-100 text-accent-700",
                      )}
                    >
                      {l.side === "buy" ? "Buyer" : "Seller"}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-medium uppercase tracking-wide",
                        l.status === "new"
                          ? "text-emerald-700"
                          : l.status === "contacted"
                            ? "text-amber-700"
                            : l.status === "converted"
                              ? "text-brand-700"
                              : "text-text-subtle",
                      )}
                    >
                      {l.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    {l.email && <>{l.email}</>}
                    {l.phone && <> · {l.phone}</>}
                    {l.source && <> · via {l.source}</>}
                  </div>
                  {l.propertyAddress && (
                    <div className="mt-1 text-xs">
                      <span className="text-text-muted">Property:</span>{" "}
                      <span className="text-text">{l.propertyAddress}</span>
                    </div>
                  )}
                  {l.areaOfInterest && (
                    <div className="mt-1 text-xs">
                      <span className="text-text-muted">Looking for:</span>{" "}
                      <span className="text-text">{l.areaOfInterest}</span>
                    </div>
                  )}
                  {(l.budget || l.timeline || l.financingStatus) && (
                    <div className="mt-1 text-xs text-text-muted">
                      {l.budget && <>Budget: <span className="text-text">{l.budget}</span></>}
                      {l.timeline && <> · Timeline: <span className="text-text">{l.timeline}</span></>}
                      {l.financingStatus && <> · Financing: <span className="text-text">{l.financingStatus}</span></>}
                    </div>
                  )}
                  {l.notes && (
                    <div className="mt-2 rounded bg-surface-2 px-2.5 py-1.5 text-xs italic text-text-muted">
                      {l.notes}
                    </div>
                  )}
                  <div className="mt-2 text-[10px] text-text-subtle">
                    Submitted {fmtDate(l.submittedAt)}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  {l.convertedTransactionId ? (
                    <a
                      href={`/transactions/${l.convertedTransactionId}`}
                      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-brand-700 hover:border-brand-500"
                    >
                      <ExternalLink className="h-3 w-3" strokeWidth={2} />
                      Open transaction
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => promote(l.id)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                    >
                      <UserPlus className="h-3 w-3" strokeWidth={2} />
                      Promote
                    </button>
                  )}
                  {l.status !== "contacted" && l.status !== "converted" && (
                    <button
                      type="button"
                      onClick={() => setStatus(l.id, "contacted")}
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-muted hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
                    >
                      <MessageCircle className="h-3 w-3" strokeWidth={2} />
                      Contacted
                    </button>
                  )}
                  {l.status !== "dismissed" && l.status !== "converted" && (
                    <button
                      type="button"
                      onClick={() => setStatus(l.id, "dismissed")}
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-subtle hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                    >
                      <Archive className="h-3 w-3" strokeWidth={2} />
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
