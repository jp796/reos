"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface PendingMatch {
  id: string;
  threadId: string;
  subject: string;
  fromEmail: string;
  matchedDomain: string | null;
  confidenceScore: number;
  extractedBuyer: string | null;
  extractedSeller: string | null;
  extractedAddress: string | null;
  extractedFileNumber: string | null;
}

interface ContactHit {
  id: string;
  fullName: string;
  primaryEmail: string | null;
  sourceName: string | null;
}

export function PendingMatchesPanel() {
  const router = useRouter();
  const [items, setItems] = useState<PendingMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/automation/pending-matches");
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onAssigned() {
    await load();
    startTransition(() => router.refresh());
  }

  if (loading && items === null) {
    return (
      <div className="mt-8 rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
        Loading pending matches…
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-8 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (!items || items.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-medium">
          Needs review ·{" "}
          <span className="text-amber-700">{items.length}</span>
        </h2>
        <span className="text-xs text-text-muted">
          Title-company emails with no automatic contact match
        </span>
      </div>
      <div className="space-y-3">
        {items.map((m) => (
          <PendingMatchRow
            key={m.id}
            match={m}
            onResolved={onAssigned}
            busy={isPending}
          />
        ))}
      </div>
    </section>
  );
}

// --------------------------------------------------
// Row component — one card per pending match
// --------------------------------------------------

function PendingMatchRow({
  match,
  onResolved,
  busy,
}: {
  match: PendingMatch;
  onResolved: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Prefill the search with the best-extracted name so most cases are a
  // single-click confirmation.
  useEffect(() => {
    const seed = match.extractedBuyer ?? match.extractedSeller ?? "";
    if (seed) setQuery(seed);
  }, [match.extractedBuyer, match.extractedSeller]);

  // Search on query change (debounced)
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/contacts/search?q=${encodeURIComponent(q)}&limit=10`,
        );
        const data = await res.json();
        setHits(data.items ?? []);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // Close suggestion panel on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setShowHits(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function assign(contact: ContactHit) {
    setWorking(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch(
        `/api/automation/pending-matches/${match.id}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: contact.id }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error || res.statusText);
        return;
      }
      setMsg(
        `Assigned to ${contact.fullName} · ${data.txnCreated ? "txn created" : "existing txn"}${data.labelApplied ? " · label applied" : ""}${data.fubStageUpdated ? " · FUB stage → Pending" : ""}`,
      );
      setTimeout(onResolved, 600);
    } catch (err) {
      setIsError(true);
      setMsg(err instanceof Error ? err.message : "assign failed");
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
        `/api/automation/pending-matches/${match.id}/ignore`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setIsError(true);
        setMsg(data.error || res.statusText);
        return;
      }
      setMsg("Ignored");
      setTimeout(onResolved, 400);
    } catch (err) {
      setIsError(true);
      setMsg(err instanceof Error ? err.message : "ignore failed");
    } finally {
      setWorking(false);
    }
  }

  const disabled = busy || working;

  return (
    <div
      ref={boxRef}
      className="rounded-md border border-amber-200 bg-amber-50/40 p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="rounded bg-surface px-1.5 py-0.5 font-mono">
          {match.matchedDomain ?? "?"}
        </span>
        <span>·</span>
        <span>conf {(match.confidenceScore * 100).toFixed(0)}%</span>
        {match.extractedFileNumber && (
          <>
            <span>·</span>
            <span>file #{match.extractedFileNumber}</span>
          </>
        )}
      </div>
      <div className="mt-1 text-sm font-medium">{match.subject}</div>
      <div className="mt-0.5 text-xs text-text-muted">
        From: {match.fromEmail}
      </div>
      {(match.extractedBuyer ||
        match.extractedSeller ||
        match.extractedAddress) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text">
          {match.extractedBuyer && (
            <span>
              <span className="text-text-muted">Buyer:</span>{" "}
              <span className="font-medium">{match.extractedBuyer}</span>
            </span>
          )}
          {match.extractedSeller && (
            <span>
              <span className="text-text-muted">Seller:</span>{" "}
              <span className="font-medium">{match.extractedSeller}</span>
            </span>
          )}
          {match.extractedAddress && (
            <span>
              <span className="text-text-muted">Address:</span>{" "}
              <span className="font-medium">{match.extractedAddress}</span>
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowHits(true);
            }}
            onFocus={() => setShowHits(true)}
            placeholder="Search contact by name or email…"
            disabled={disabled}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm disabled:opacity-50"
          />
          {showHits && hits.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    setShowHits(false);
                    assign(h);
                  }}
                  disabled={disabled}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <div className="font-medium">{h.fullName}</div>
                  <div className="text-xs text-text-muted">
                    {h.primaryEmail ?? "no email"}
                    {h.sourceName && ` · ${h.sourceName}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={ignore}
          disabled={disabled}
          className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
        >
          Ignore
        </button>
      </div>
      {msg && (
        <div
          className={`mt-2 text-xs ${
            isError ? "text-red-700" : "text-emerald-700"
          }`}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
