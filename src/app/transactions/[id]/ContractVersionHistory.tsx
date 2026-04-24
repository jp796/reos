"use client";

/**
 * ContractVersionHistory — timeline of every contract extraction
 * snapshot for this transaction, with a field-level diff viewer
 * between any two versions.
 *
 * Use case: a counter-offer comes in → rescan → extraction creates
 * a new pending version AND snapshots the old one. The TC opens
 * this panel and sees "Closing date changed Apr 30 → May 15, price
 * went from $450k → $462k, inspection deadline removed."
 *
 * Displayed only when there's at least one prior version to diff
 * against. No versions = nothing to show, panel hides itself.
 */

import { useEffect, useMemo, useState } from "react";
import { History, ArrowRight } from "lucide-react";

interface VersionRow {
  id: string;
  source: string;
  filename: string | null;
  sourceDate: string;
  createdAt: string;
  extraction: Record<string, unknown>;
}

interface Response {
  current: Record<string, unknown> | null;
  currentSourceDate: string | null;
  versions: VersionRow[];
}

/** Fields we diff — matches what the extractor emits. */
const DIFF_FIELDS: Array<{ key: string; label: string; kind: "date" | "money" | "text" | "pct" | "names" }> = [
  { key: "effectiveDate", label: "Effective date", kind: "date" },
  { key: "closingDate", label: "Closing", kind: "date" },
  { key: "possessionDate", label: "Possession", kind: "date" },
  { key: "inspectionDeadline", label: "Inspection deadline", kind: "date" },
  { key: "inspectionObjectionDeadline", label: "Inspection objection", kind: "date" },
  { key: "titleCommitmentDeadline", label: "Title commitment", kind: "date" },
  { key: "titleObjectionDeadline", label: "Title objection", kind: "date" },
  { key: "financingDeadline", label: "Financing deadline", kind: "date" },
  { key: "walkthroughDate", label: "Walkthrough", kind: "date" },
  { key: "earnestMoneyDueDate", label: "Earnest money due", kind: "date" },
  { key: "purchasePrice", label: "Purchase price", kind: "money" },
  { key: "earnestMoneyAmount", label: "Earnest money amount", kind: "money" },
  { key: "sellerSideCommissionPct", label: "Seller commission %", kind: "pct" },
  { key: "buyerSideCommissionPct", label: "Buyer commission %", kind: "pct" },
  { key: "sellerSideCommissionAmount", label: "Seller commission $", kind: "money" },
  { key: "buyerSideCommissionAmount", label: "Buyer commission $", kind: "money" },
  { key: "propertyAddress", label: "Property address", kind: "text" },
  { key: "titleCompanyName", label: "Title company", kind: "text" },
  { key: "lenderName", label: "Lender", kind: "text" },
  { key: "buyers", label: "Buyers", kind: "names" },
  { key: "sellers", label: "Sellers", kind: "names" },
];

function getValue(ext: Record<string, unknown> | null, key: string): unknown {
  if (!ext) return null;
  const f = ext[key] as { value?: unknown } | undefined;
  if (!f || typeof f !== "object") return null;
  return f.value ?? null;
}

function fmt(val: unknown, kind: string): string {
  if (val === null || val === undefined || val === "") return "—";
  if (kind === "names" && Array.isArray(val)) return val.join(", ");
  if (kind === "date" && typeof val === "string") {
    try {
      return new Date(val).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return val;
    }
  }
  if (kind === "money" && typeof val === "number") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(val);
  }
  if (kind === "pct" && typeof val === "number") {
    return val > 1 ? `${val}%` : `${val * 100}%`;
  }
  return String(val);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}

function sourceLabel(s: string): string {
  switch (s) {
    case "upload":
      return "Manual upload";
    case "rescan_gmail":
      return "Rescan · Gmail";
    case "rescan_stored":
      return "Rescan · stored";
    default:
      return s;
  }
}

export function ContractVersionHistory({
  transactionId,
}: {
  transactionId: string;
}) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  // Which two versions to diff. Default: current vs most-recent snapshot.
  const [leftId, setLeftId] = useState<string>("");
  const [rightId, setRightId] = useState<string>("current");

  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/transactions/${transactionId}/contract/versions`,
        );
        const d = (await res.json()) as Response;
        if (!done) {
          setData(d);
          setLeftId(d.versions[0]?.id ?? "");
          setLoading(false);
        }
      } catch {
        if (!done) setLoading(false);
      }
    })();
    return () => {
      done = true;
    };
  }, [transactionId]);

  const versionsWithCurrent = useMemo(() => {
    if (!data) return [];
    const list: Array<{
      id: string;
      label: string;
      extraction: Record<string, unknown> | null;
      sourceDate: string | null;
    }> = [];
    if (data.current) {
      list.push({
        id: "current",
        label: "Current (pending)",
        extraction: data.current,
        sourceDate: data.currentSourceDate,
      });
    }
    for (const v of data.versions) {
      list.push({
        id: v.id,
        label: `${sourceLabel(v.source)} · ${new Date(v.sourceDate).toLocaleString()}${v.filename ? ` · ${v.filename}` : ""}`,
        extraction: v.extraction,
        sourceDate: v.sourceDate,
      });
    }
    return list;
  }, [data]);

  const leftVersion = versionsWithCurrent.find((v) => v.id === leftId);
  const rightVersion = versionsWithCurrent.find((v) => v.id === rightId);

  const diff = useMemo(() => {
    if (!leftVersion || !rightVersion) return [];
    return DIFF_FIELDS.map((f) => {
      const l = getValue(leftVersion.extraction, f.key);
      const r = getValue(rightVersion.extraction, f.key);
      return { field: f, left: l, right: r, changed: !sameValue(l, r) };
    });
  }, [leftVersion, rightVersion]);

  const changedCount = diff.filter((d) => d.changed).length;

  if (loading) return null;
  // Nothing to show if only current exists (no history)
  if (!data || data.versions.length === 0) return null;

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <History className="h-4 w-4 text-text-muted" strokeWidth={1.8} />
          Contract versions
          <span className="font-normal text-text-muted">
            · {data.versions.length + (data.current ? 1 : 0)} total
          </span>
        </h2>
        <div className="text-xs">
          {changedCount > 0 ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
              {changedCount} field{changedCount === 1 ? "" : "s"} changed
            </span>
          ) : (
            <span className="text-text-muted">No differences</span>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <select
          value={leftId}
          onChange={(e) => setLeftId(e.target.value)}
          className="max-w-[280px] truncate rounded border border-border bg-surface-2 px-2 py-1 text-xs"
        >
          {versionsWithCurrent.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <ArrowRight className="h-3.5 w-3.5 text-text-muted" strokeWidth={2} />
        <select
          value={rightId}
          onChange={(e) => setRightId(e.target.value)}
          className="max-w-[280px] truncate rounded border border-border bg-surface-2 px-2 py-1 text-xs"
        >
          {versionsWithCurrent.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Left</th>
              <th className="px-3 py-2 font-medium">Right</th>
            </tr>
          </thead>
          <tbody>
            {diff
              .filter((d) => d.changed || d.left || d.right)
              .map((d) => (
                <tr
                  key={d.field.key}
                  className={
                    d.changed
                      ? "border-t border-amber-200 bg-amber-50/40"
                      : "border-t border-neutral-100"
                  }
                >
                  <td className="px-3 py-1.5 font-medium">{d.field.label}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {fmt(d.left, d.field.kind)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {d.changed ? (
                      <span className="font-medium text-amber-900">
                        {fmt(d.right, d.field.kind)}
                      </span>
                    ) : (
                      fmt(d.right, d.field.kind)
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
