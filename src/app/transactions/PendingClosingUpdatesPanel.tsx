"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface ClosingUpdate {
  id: string;
  transactionId: string;
  contactName: string;
  propertyAddress: string | null;
  documentType: string;
  anchor: string;
  extractedDate: string;
  previousDate: string | null;
  proposedStage: string | null;
  side: string | null;
  confidence: number;
  snippet: string | null;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PendingClosingUpdatesPanel() {
  const router = useRouter();
  const [items, setItems] = useState<ClosingUpdate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/automation/pending-closing-updates");
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function cleanupLowConfidence() {
    try {
      const res = await fetch(
        "/api/automation/pending-closing-updates/cleanup-low-confidence",
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      await load();
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "cleanup failed");
    }
  }

  async function bulkApplyAll() {
    const count = items?.length ?? 0;
    if (count === 0) return;
    if (
      !window.confirm(
        `Apply all ${count} pending closing-date updates to FUB?\n\nThis will:\n- Update each person's dealCloseDate\n- Move their FUB stage to Closed\n- Flip the local transaction status to closed\n\nReversible per-row via the audit log, not via undo.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const res = await fetch(
        "/api/automation/pending-closing-updates/bulk-apply",
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setBulkMsg(`Error: ${data.error ?? res.statusText}`);
        return;
      }
      setBulkMsg(
        `Bulk apply: ${data.applied} applied · ${data.financialsPopulated ?? 0} financials auto-filled · ${data.skipped} local-only · ${data.errored} errored`,
      );
      await load();
      startTransition(() => router.refresh());
    } catch (e) {
      setBulkMsg(e instanceof Error ? e.message : "bulk apply failed");
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading && items === null) return null;
  if (err)
    return (
      <div className="mt-8 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {err}
      </div>
    );
  if (!items || items.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-medium">
          Closing dates to confirm ·{" "}
          <span className="text-amber-700">{items.length}</span>
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-text-muted">
            From Settlement Statement PDFs
          </span>
          <button
            type="button"
            onClick={cleanupLowConfidence}
            className="rounded border border-border-strong bg-surface px-2 py-1 font-medium text-text hover:border-border-strong"
          >
            Ignore low-confidence
          </button>
          <button
            type="button"
            onClick={bulkApplyAll}
            disabled={bulkBusy}
            className="rounded bg-emerald-700 px-2 py-1 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {bulkBusy ? "Applying…" : "Apply all"}
          </button>
        </div>
      </div>
      {bulkMsg && (
        <div className="mb-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          {bulkMsg}
        </div>
      )}
      <div className="space-y-3">
        {items.map((it) => (
          <ClosingUpdateRow
            key={it.id}
            update={it}
            onDone={() => {
              load();
              startTransition(() => router.refresh());
            }}
            busy={isPending}
          />
        ))}
      </div>
    </section>
  );
}

function ClosingUpdateRow({
  update,
  onDone,
  busy,
}: {
  update: ClosingUpdate;
  onDone: () => void;
  busy: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function apply() {
    setWorking(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(
        `/api/automation/pending-closing-updates/${update.id}/apply`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error || res.statusText);
        return;
      }
      const parts: string[] = [];
      if (data.fubDateUpdated) {
        parts.push(`FUB closeDate → ${fmtDate(data.newClosingDate)}`);
      }
      if (data.fubStageUpdated && data.newStage) {
        parts.push(`FUB stage → ${data.newStage}`);
      }
      if (!data.fubDateUpdated && !data.fubStageUpdated) {
        parts.push("FUB not pushed (no fubPersonId)");
      }
      setMsg(`Applied · ${parts.join(" · ")}`);
      setTimeout(onDone, 700);
    } catch (e) {
      setIsError(true);
      setMsg(e instanceof Error ? e.message : "apply failed");
    } finally {
      setWorking(false);
    }
  }

  async function ignore() {
    setWorking(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(
        `/api/automation/pending-closing-updates/${update.id}/ignore`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error || res.statusText);
        return;
      }
      setMsg("Ignored");
      setTimeout(onDone, 500);
    } catch (e) {
      setIsError(true);
      setMsg(e instanceof Error ? e.message : "ignore failed");
    } finally {
      setWorking(false);
    }
  }

  const disabled = busy || working;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="rounded bg-surface px-1.5 py-0.5 font-mono">
          {update.documentType}
        </span>
        {update.side && (
          <>
            <span>·</span>
            <span className="rounded bg-surface px-1.5 py-0.5 uppercase">
              {update.side === "buy" ? "buyer" : "seller"}
            </span>
          </>
        )}
        <span>·</span>
        <span>conf {(update.confidence * 100).toFixed(0)}%</span>
        <span>·</span>
        <span>anchor: {update.anchor}</span>
        {update.proposedStage && (
          <>
            <span>·</span>
            <span className="rounded bg-surface px-1.5 py-0.5 text-emerald-800">
              → stage {update.proposedStage}
            </span>
          </>
        )}
      </div>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <Link
          href={`/transactions/${update.transactionId}`}
          className="font-medium hover:underline"
        >
          {update.contactName}
        </Link>
        {update.propertyAddress && (
          <span className="text-text-muted">· {update.propertyAddress}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <div>
          <span className="text-text-muted">Current: </span>
          <span className="font-medium">{fmtDate(update.previousDate)}</span>
        </div>
        <span className="text-text-subtle">→</span>
        <div>
          <span className="text-text-muted">Proposed: </span>
          <span className="font-medium text-emerald-800">
            {fmtDate(update.extractedDate)}
          </span>
        </div>
      </div>
      {update.snippet && (
        <div className="mt-2 rounded border border-border bg-surface px-2 py-1 text-xs italic text-text-muted">
          “{update.snippet}”
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={disabled}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {working ? "Applying…" : "Apply to FUB"}
        </button>
        <button
          type="button"
          onClick={ignore}
          disabled={disabled}
          className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
        >
          Ignore
        </button>
        {msg && (
          <span
            className={`text-xs ${isError ? "text-red-600" : "text-emerald-700"}`}
          >
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
