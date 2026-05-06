"use client";

import { useState } from "react";
import { Check, Copy, Link2, X } from "lucide-react";

interface Props {
  transactionId: string;
  initialToken: string | null;
  initialExpiresAt: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Create / copy / revoke the public share link for this transaction's
 * read-only timeline. Anyone with the link sees a clean, buyer-/seller-
 * friendly view — no financials, no contacts, no emails.
 */
export function SharePanel(props: Props) {
  const [token, setToken] = useState<string | null>(props.initialToken);
  const [expiresAt, setExpiresAt] = useState<string | null>(
    props.initialExpiresAt,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== "undefined" && token
      ? `${window.location.origin}/share/timeline/${token}`
      : token
        ? `/share/timeline/${token}`
        : null;

  async function createLink() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/share`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setToken(data.token);
      setExpiresAt(data.expiresAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm("Revoke this share link?\nAnyone with it will see a 'link expired' page.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/share`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErr(data?.error ?? `Failed (${res.status})`);
        return;
      }
      setToken(null);
      setExpiresAt(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "revoke failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Share timeline</h2>
        <span className="text-xs text-text-muted">
          Read-only view · no financials or emails shown
        </span>
      </div>

      {!token ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-muted">
            Generate a link buyers, sellers, lenders, or attorneys can open
            — they&apos;ll see the property, key dates, and milestone
            progress. No sign-in required.
          </p>
          <button
            type="button"
            onClick={createLink}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <Link2 className="h-4 w-4" strokeWidth={1.8} />
            {busy ? "Creating…" : "Create share link"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-text">
              {url ?? "(link will appear here once you reload)"}
            </code>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text hover:border-brand-500 hover:text-brand-700"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" strokeWidth={2} /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.8} /> Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-muted hover:border-red-300 hover:text-danger disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              Revoke
            </button>
          </div>
          {expiresAt && (
            <div className="text-xs text-text-muted">
              Expires {fmtDate(expiresAt)} ·{" "}
              <button
                type="button"
                onClick={createLink}
                disabled={busy}
                className="text-brand-700 underline hover:text-brand-600"
              >
                rotate to extend
              </button>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}
    </section>
  );
}
