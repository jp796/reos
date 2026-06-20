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
type DocStatus = "pending" | "uploaded" | "has_issues" | "fully_executed";
interface Item {
  requirement: {
    key: string;
    label: string;
    detail?: string;
    stage?: string;
    authority?: string;
  };
  status: "present" | "missing";
  docStatus?: DocStatus;
  matches: Match[];
}

const DOC_STATUS_BADGE: Record<DocStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-surface-2 text-text-muted ring-border" },
  uploaded: { label: "Uploaded", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  has_issues: { label: "Has issues", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  fully_executed: { label: "Fully executed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

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

export function CompliancePanel({
  transactionId,
  appliedName: initialApplied = null,
}: {
  transactionId: string;
  appliedName?: string | null;
}) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [templates, setTemplates] = useState<{ id: string; name: string; itemCount: number }[]>([]);
  const [appliedName, setAppliedName] = useState<string | null>(initialApplied);
  const [applying, setApplying] = useState(false);

  async function loadTemplates() {
    if (templates.length > 0) return;
    try {
      const res = await fetch("/api/compliance-templates");
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch {
      /* ignore */
    }
  }

  async function applyTemplate(templateId: string, clear = false) {
    setApplying(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/apply-compliance-template`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clear ? { clear: true } : { templateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "apply failed");
      setAppliedName(clear ? null : (data.applied ?? null));
      await fetchAudit();
    } catch {
      /* surfaced via re-scan failing silently; keep UI simple */
    } finally {
      setApplying(false);
    }
  }

  async function saveAsTemplate() {
    const name = window.prompt("Save this deal's document checklist as a template. Name:");
    if (name === null) return;
    try {
      const res = await fetch(`/api/transactions/${transactionId}/save-as-compliance-template`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      window.alert(`Saved "${data.name}" — ${data.count} documents. Apply it to other deals from their Compliance tab.`);
    } catch (e) {
      window.alert(`Couldn't save: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

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
        <div className="flex items-center gap-1.5">
          <select
            defaultValue=""
            disabled={applying}
            onFocus={loadTemplates}
            onMouseDown={loadTemplates}
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v === "__clear") applyTemplate("", true);
              else if (v) applyTemplate(v);
            }}
            title="Apply a saved compliance checklist to this deal"
            className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-text-muted hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
          >
            <option value="" disabled>
              {applying ? "Applying…" : "Apply checklist…"}
            </option>
            {templates.length === 0 ? (
              <option value="" disabled>
                No checklists — create in Settings
              </option>
            ) : (
              templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.itemCount})
                </option>
              ))
            )}
            {appliedName && <option value="__clear">↩ Revert to default</option>}
          </select>
          <button
            type="button"
            onClick={saveAsTemplate}
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-muted hover:border-brand-500 hover:text-brand-700"
            title="Save this checklist as a reusable template"
          >
            Save as template
          </button>
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
      </div>
      {appliedName && (
        <div className="mb-3 -mt-1 text-xs text-text-muted">
          Using checklist: <span className="font-medium text-text">{appliedName}</span>
        </div>
      )}

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
          {item.docStatus && (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                DOC_STATUS_BADGE[item.docStatus].cls,
              )}
            >
              {DOC_STATUS_BADGE[item.docStatus].label}
            </span>
          )}
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
