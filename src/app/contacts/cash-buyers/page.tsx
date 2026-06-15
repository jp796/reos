"use client";

/**
 * Cash-buyers segment page (spec §7) — the wholesale disposition
 * channel. List the saved cash buyers, add any contact via search,
 * remove, and copy all emails for a blast.
 */

import { useEffect, useState, useCallback } from "react";
import { Search, Plus, X, Copy, Users } from "lucide-react";

interface Buyer {
  id: string;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
}

export default function CashBuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Buyer[]>([]);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch("/api/contacts/cash-buyers").then((r) => r.json());
      setBuyers(data.contacts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const data = await fetch(
        `/api/contacts/search?q=${encodeURIComponent(q)}&limit=10`,
      ).then((r) => r.json());
      const ids = new Set(buyers.map((b) => b.id));
      setResults((data.items ?? []).filter((c: Buyer) => !ids.has(c.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, buyers]);

  async function add(contactId: string) {
    await fetch("/api/contacts/cash-buyers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    setQ("");
    setResults([]);
    void load();
  }

  async function remove(contactId: string) {
    await fetch(`/api/contacts/cash-buyers?contactId=${contactId}`, {
      method: "DELETE",
    });
    void load();
  }

  const emails = buyers.map((b) => b.primaryEmail).filter(Boolean).join(", ");
  function copyEmails() {
    if (!emails) return;
    void navigator.clipboard.writeText(emails);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-brand-700" strokeWidth={1.8} />
        <h1 className="font-display text-h1 font-semibold">Cash buyers</h1>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        Your wholesale disposition list. Tag contacts here, then blast the
        segment when a deal goes to market.
      </p>

      {/* Add */}
      <div className="mt-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" strokeWidth={1.8} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search contacts to add…"
            className="w-full rounded-md border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        {results.length > 0 && (
          <ul className="mt-1 divide-y divide-border rounded border border-border bg-surface">
            {results.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                <div>
                  <span className="font-medium text-text">{c.fullName}</span>
                  {c.primaryEmail && <span className="ml-2 text-xs text-text-muted">{c.primaryEmail}</span>}
                </div>
                <button onClick={() => add(c.id)} className="inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-500">
                  <Plus className="h-3 w-3" strokeWidth={2} /> Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* List */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {buyers.length} cash buyer{buyers.length === 1 ? "" : "s"}
        </h2>
        {emails && (
          <button onClick={copyEmails} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:border-brand-500 hover:text-brand-700">
            <Copy className="h-3 w-3" strokeWidth={1.8} /> {copied ? "Copied!" : "Copy all emails"}
          </button>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-text-muted">Loading…</p>
      ) : buyers.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border bg-surface p-8 text-center text-sm text-text-muted">
          No cash buyers yet. Search above to add some.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface">
          {buyers.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div>
                <span className="font-medium text-text">{b.fullName}</span>
                <span className="ml-2 text-xs text-text-muted">
                  {[b.primaryEmail, b.primaryPhone].filter(Boolean).join(" · ") || "no contact info"}
                </span>
              </div>
              <button onClick={() => remove(b.id)} className="text-text-subtle hover:text-red-600" title="Remove from segment">
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
