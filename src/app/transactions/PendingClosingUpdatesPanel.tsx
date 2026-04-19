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

  if (loading && items === null) return null;
  if (err)
    return (
      <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {err}
      </div>
    );
  if (!items || items.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-medium">
          Closing dates to confirm ·{" "}
          <span className="text-amber-700">{items.length}</span>
        </h2>
        <span className="text-xs text-neutral-500">
          Extracted from Settlement Statement / Closing Disclosure PDFs
        </span>
      </div>
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
      setMsg(
        `Applied · FUB dealCloseDate = ${fmtDate(data.newClosingDate)}${
          data.fubUpdated ? "" : " (FUB not pushed — no fubPersonId)"
        }`,
      );
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
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span className="rounded bg-white px-1.5 py-0.5 font-mono">
          {update.documentType}
        </span>
        <span>·</span>
        <span>conf {(update.confidence * 100).toFixed(0)}%</span>
        <span>·</span>
        <span>anchor: {update.anchor}</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <Link
          href={`/transactions/${update.transactionId}`}
          className="font-medium hover:underline"
        >
          {update.contactName}
        </Link>
        {update.propertyAddress && (
          <span className="text-neutral-500">· {update.propertyAddress}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <div>
          <span className="text-neutral-500">Current: </span>
          <span className="font-medium">{fmtDate(update.previousDate)}</span>
        </div>
        <span className="text-neutral-300">→</span>
        <div>
          <span className="text-neutral-500">Proposed: </span>
          <span className="font-medium text-emerald-800">
            {fmtDate(update.extractedDate)}
          </span>
        </div>
      </div>
      {update.snippet && (
        <div className="mt-2 rounded border border-neutral-200 bg-white px-2 py-1 text-xs italic text-neutral-600">
          “{update.snippet}”
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={disabled}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {working ? "Applying…" : "Apply to FUB"}
        </button>
        <button
          type="button"
          onClick={ignore}
          disabled={disabled}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
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
