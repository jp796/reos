"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  transactionId: string;
  initialEmail: string | null;
  initialProvider: string | null;
  initialLastRunAt: string | null;
  smartFolderReady: boolean;
}

const PROVIDERS = [
  { id: "rezen", label: "Rezen" },
  { id: "dotloop", label: "Dotloop" },
  { id: "skyslope", label: "SkySlope" },
  { id: "dealpack", label: "Dealpack" },
  { id: "brokermint", label: "BrokerMint" },
  { id: "other", label: "Other" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ForwardingPanel(props: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(props.initialEmail ?? "");
  const [provider, setProvider] = useState(props.initialProvider ?? "rezen");
  const [savedEmail, setSavedEmail] = useState(props.initialEmail);
  const [editing, setEditing] = useState(!props.initialEmail);
  const [saving, setSaving] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [, startTransition] = useTransition();

  async function save() {
    setSaving(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/forwarding`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            forwardingEmail: email.trim() || null,
            forwardingEmailProvider: provider,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error ?? res.statusText);
        return;
      }
      setSavedEmail(email.trim() || null);
      setEditing(false);
      setMsg("Saved");
      startTransition(() => router.refresh());
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setIsError(true);
      setMsg(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function forwardNow() {
    if (!savedEmail) return;
    if (
      !window.confirm(
        `Forward all unforwarded PDFs in this transaction's folder to ${savedEmail}?`,
      )
    ) {
      return;
    }
    setForwarding(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/forwarding`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error ?? res.statusText);
        return;
      }
      setMsg(
        `Forwarded ${data.forwarded} · skipped ${data.skipped} · errored ${data.errored}`,
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setIsError(true);
      setMsg(e instanceof Error ? e.message : "forward failed");
    } finally {
      setForwarding(false);
    }
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Transaction Email Forwarding</h2>
        <span className="text-xs text-text-muted">
          Auto-upload PDFs to Dotloop / Rezen / SkySlope via their
          per-deal ingest email
        </span>
      </div>

      {editing || !savedEmail ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_auto]">
          <div>
            <label className="mb-1 block text-xs text-text-muted">
              Platform
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">
              Transaction email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. 2406e10thst-t@rezenfilecabinet.com"
              className="w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
              autoComplete="off"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {props.initialEmail && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setEmail(props.initialEmail ?? "");
                }}
                className="rounded border border-border-strong bg-surface px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-text-muted">Uploading to </span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
              {savedEmail}
            </span>
            {props.initialProvider && (
              <span className="ml-2 text-xs text-text-muted">
                via {props.initialProvider}
              </span>
            )}
            <span className="ml-2 text-xs text-text-muted">
              · last run {fmtDate(props.initialLastRunAt)}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={forwardNow}
              disabled={forwarding || !props.smartFolderReady}
              title={
                !props.smartFolderReady
                  ? "Create a SmartFolder first so we know which emails to forward"
                  : undefined
              }
              className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {forwarding ? "Forwarding…" : "Forward new PDFs"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-border-strong bg-surface px-3 py-1.5 text-sm"
            >
              Edit
            </button>
          </div>
        </div>
      )}

      {!props.smartFolderReady && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          SmartFolder isn&apos;t set up for this transaction yet. Create one
          above so we know which emails to forward.
        </div>
      )}

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
