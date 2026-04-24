"use client";

/**
 * CompliancePanel
 *
 * Shows the TC file-audit status for this transaction — required
 * docs (per side + state) vs what's actually in REOS. Each requirement
 * row is green (present) or red (missing) with the matched filenames
 * listed under the green ones.
 *
 * Data source: /api/transactions/:id/compliance — fired on mount,
 * refreshable via the "Re-scan" button (e.g. after a new Document
 * row lands from contract rescan or Gmail attachment forwarding).
 */

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, AlertCircle, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/cn";

interface Match {
  id: string;
  fileName: string;
  source: string;
}
interface Item {
  requirement: {
    key: string;
    label: string;
    detail?: string;
    stage?: string;
    authority?: string;
  };
  status: "present" | "missing";
  matches: Match[];
}

interface Audit {
  items: Item[];
  present: number;
  missing: number;
  total: number;
}

const STAGE_LABELS: Record<string, string> = {
  before_contract: "Before contract",
  under_contract: "Under contract",
  before_close: "Before close",
  post_close: "Post close",
};

export function CompliancePanel({ transactionId }: { transactionId: string }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function fetchAudit() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/compliance`,
      );
      if (res.ok) {
        const data = await res.json();
        setAudit(data);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  // Group by stage for readability
  const byStage = new Map<string, Item[]>();
  if (audit) {
    for (const it of audit.items) {
      const stage = it.requirement.stage ?? "under_contract";
      const list = byStage.get(stage) ?? [];
      list.push(it);
      byStage.set(stage, list);
    }
  }
  const stageOrder = [
    "before_contract",
    "under_contract",
    "before_close",
    "post_close",
  ];

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          Compliance file audit
          {audit && (
            <span className="ml-2 font-normal text-text-muted">
              · {audit.present}/{audit.total}
              {audit.missing > 0 && (
                <span className="ml-1 text-danger">
                  · {audit.missing} missing
                </span>
              )}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => startTransition(() => void fetchAudit())}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-muted hover:border-border-strong hover:text-text disabled:opacity-50"
          title="Re-scan after uploading or labeling new docs"
        >
          <RefreshCcw className={cn("h-3 w-3", busy && "animate-spin")} strokeWidth={2} />
          Re-scan
        </button>
      </div>

      {!audit ? (
        <div className="rounded border border-dashed border-border bg-surface-2 p-4 text-sm text-text-muted">
          Loading…
        </div>
      ) : audit.items.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface-2 p-4 text-sm text-text-muted">
          No compliance rules configured for this side + state.
        </div>
      ) : (
        <div className="space-y-4">
          {stageOrder.map((stage) => {
            const items = byStage.get(stage);
            if (!items || items.length === 0) return null;
            return (
              <div key={stage}>
                <div className="reos-label mb-1.5">
                  {STAGE_LABELS[stage] ?? stage}
                </div>
                <ul className="space-y-1">
                  {items.map((it) => (
                    <ComplianceRow key={it.requirement.key} item={it} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ComplianceRow({ item }: { item: Item }) {
  const present = item.status === "present";
  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-2 rounded border px-3 py-2 text-sm",
        present
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-red-200 bg-red-50/40",
      )}
    >
      {present ? (
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
          strokeWidth={2}
        />
      ) : (
        <AlertCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
          strokeWidth={2}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-text">
            {item.requirement.label}
          </span>
          {item.requirement.authority && (
            <span
              className="text-[10px] text-text-subtle"
              title={item.requirement.authority}
            >
              ⓘ
            </span>
          )}
        </div>
        {item.requirement.detail && (
          <div className="mt-0.5 text-xs text-text-muted">
            {item.requirement.detail}
          </div>
        )}
        {present && item.matches.length > 0 && (
          <div className="mt-1 text-xs text-emerald-700">
            {item.matches.map((m) => m.fileName).join(" · ")}
          </div>
        )}
      </div>
    </li>
  );
}
