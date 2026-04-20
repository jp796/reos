"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  transactionId: string;
  createdAt: string;
  labelName: string | null;
  filterId: string | null;
  setupAt: string | null;
  backfillCount: number | null;
  eligible: boolean;
  eligibilityReason: string | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SmartFolderSection(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [, startTransition] = useTransition();

  // Already configured
  if (props.filterId && props.setupAt) {
    return (
      <section className="mt-6 rounded-md border border-emerald-200 bg-emerald-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-emerald-700">
              SmartFolder · active
            </div>
            <div className="mt-1 text-sm font-medium">
              {props.labelName ?? "(no label)"}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              Set up {fmtDate(props.setupAt)} ·{" "}
              {props.backfillCount ?? 0} past thread(s) labeled · future
              matches auto-filed
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Not eligible (pre-cutoff, etc.)
  if (!props.eligible) {
    return null;
  }

  async function setup() {
    setBusy(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/smart-folder`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error ?? res.statusText);
        return;
      }
      const r = data.result;
      if (r?.configured) {
        setMsg(
          `Folder "${r.labelName}" created · ${r.backfillCount ?? 0} past thread(s) labeled · future matches auto-filed.`,
        );
        startTransition(() => router.refresh());
      } else if (r?.reason === "insufficient_scope_reconnect_google") {
        setIsError(true);
        setMsg(
          `Label created + ${r.backfillCount ?? 0} past thread(s) labeled, but the Gmail scope for auto-filters is missing. Reconnect Google (top-right) to enable future auto-filing, then click again.`,
        );
        startTransition(() => router.refresh());
      } else {
        setIsError(true);
        setMsg(`Not configured: ${r?.reason ?? "unknown"}`);
      }
    } catch (e) {
      setIsError(true);
      setMsg(e instanceof Error ? e.message : "setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">
            SmartFolder
          </div>
          <div className="mt-1 text-sm text-text">
            Create a Gmail folder for this address and auto-file every
            future email about it. Past matching threads in the last 365d
            get labeled too.
          </div>
        </div>
        <button
          type="button"
          onClick={setup}
          disabled={busy}
          className="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {busy ? "Setting up…" : "Create SmartFolder"}
        </button>
      </div>
      {msg && (
        <div
          className={`mt-3 rounded border px-3 py-2 text-xs ${isError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {msg}
        </div>
      )}
    </section>
  );
}
