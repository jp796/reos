"use client";

import { useState } from "react";
import { Search, ExternalLink } from "lucide-react";

type DocType = "any" | "ss" | "em" | "invoice" | "contract";

interface SearchHit {
  threadId: string;
  subject: string;
  from: string;
  date: string | null;
  snippet: string | null;
  attachments: string[];
  gmailUrl: string;
}

const TYPE_LABELS: Record<DocType, string> = {
  any: "Any document",
  ss: "Settlement statement",
  em: "Earnest money",
  invoice: "Invoice / bill",
  contract: "Contract",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Ad-hoc Gmail search scoped to a name / address / file number
 * plus an optional doc-type filter. Surfaces matching threads so
 * the user can open them, link to a contact, or trigger a scan.
 */
export function GmailSearchPanel() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<DocType>("any");
  const [days, setDays] = useState<number>(365);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    setResults(null);
    try {
      const res = await fetch("/api/automation/search-gmail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim(), type, days }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setResults(data.results ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-md border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Scan for…</h2>
        <span className="text-xs text-text-muted">
          Search Gmail by name, address, or file number
        </span>
      </div>
      <form
        onSubmit={run}
        className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_120px_auto]"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle"
            strokeWidth={1.8}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Curtis Lacky / 4769 Windmill / File #3002010"
            className="w-full rounded border border-border bg-surface-2 py-1.5 pl-8 pr-2 text-sm placeholder:text-text-subtle"
            required
          />
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as DocType)}
          className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
        >
          {Object.entries(TYPE_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={String(days)}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
        >
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="180">180 days</option>
          <option value="365">1 year</option>
          <option value="730">2 years</option>
          <option value="1095">3 years</option>
        </select>
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      {err && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}

      {results && (
        <div className="mt-4">
          {results.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No threads matched &ldquo;{query}&rdquo; in the last {days} days.
            </p>
          ) : (
            <>
              <div className="mb-2 text-xs text-text-muted">
                <span className="tabular-nums">{results.length}</span> thread
                {results.length === 1 ? "" : "s"} matching &ldquo;{query}&rdquo;
              </div>
              <ul className="divide-y divide-border rounded border border-border">
                {results.map((r) => (
                  <li
                    key={r.threadId}
                    className="flex items-start justify-between gap-3 p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-text">
                        {r.subject}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-text-muted">
                        {r.from} · {fmtDate(r.date)}
                      </div>
                      {r.attachments.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.attachments.map((a) => (
                            <span
                              key={a}
                              className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted ring-1 ring-border"
                            >
                              {a.length > 40 ? a.slice(0, 38) + "…" : a}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.snippet && (
                        <div className="mt-1 line-clamp-2 text-xs italic text-text-subtle">
                          {r.snippet}
                        </div>
                      )}
                    </div>
                    <a
                      href={r.gmailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded border border-border bg-surface px-2 py-1 text-xs text-text-muted hover:border-brand-500 hover:text-brand-700"
                    >
                      <ExternalLink
                        className="inline h-3 w-3"
                        strokeWidth={1.8}
                      />{" "}
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
