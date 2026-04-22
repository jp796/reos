"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, User, Home as HomeIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

interface ContactHit {
  id: string;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  sourceName: string | null;
}
interface TxnHit {
  id: string;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  status: string;
  side: string | null;
  closingDate: string | null;
  contactName: string;
}
interface SearchResponse {
  query: string;
  contacts: ContactHit[];
  transactions: TxnHit[];
}

/**
 * Sticky search box in the AppShell header. Debounced 200ms,
 * keyboard-first (/ to focus, Esc to close, ↑↓ to move, Enter to
 * open first result). Searches contacts + transactions in parallel.
 */
export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Keyboard: "/" to focus, "Esc" to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-away close
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced fetch
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
        );
        const data: SearchResponse = await res.json();
        setResults(data);
      } catch {
        // ignore
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const total =
    (results?.contacts.length ?? 0) + (results?.transactions.length ?? 0);

  return (
    <div ref={wrapRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle"
          strokeWidth={1.8}
        />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          placeholder="Search contacts + transactions…"
          className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-9 text-sm placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:block">
          /
        </kbd>
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[480px] overflow-auto rounded-md border border-border bg-surface shadow-lg">
          {busy && !results && (
            <div className="flex items-center gap-2 p-4 text-xs text-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              Searching…
            </div>
          )}

          {results && total === 0 && !busy && (
            <div className="p-4 text-center text-xs text-text-muted">
              No contacts or transactions match &ldquo;{q}&rdquo;.
            </div>
          )}

          {results && results.transactions.length > 0 && (
            <Section label="Transactions">
              {results.transactions.map((t) => (
                <Link
                  key={t.id}
                  href={`/transactions/${t.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2 hover:bg-surface-2"
                >
                  <HomeIcon
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
                    strokeWidth={1.8}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">
                      {t.propertyAddress ?? t.contactName}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {t.contactName}
                      {t.side && ` · ${t.side}`}
                      {t.status && ` · ${t.status}`}
                      {t.closingDate && ` · closes ${fmtDate(t.closingDate)}`}
                    </div>
                  </div>
                </Link>
              ))}
            </Section>
          )}

          {results && results.contacts.length > 0 && (
            <Section label="Contacts">
              {results.contacts.map((c) => (
                <Link
                  key={c.id}
                  href={`/contacts?id=${c.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2 hover:bg-surface-2"
                >
                  <User
                    className="mt-0.5 h-4 w-4 shrink-0 text-accent-500"
                    strokeWidth={1.8}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">
                      {c.fullName}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {c.primaryEmail ?? c.primaryPhone ?? "—"}
                      {c.sourceName && ` · ${c.sourceName}`}
                    </div>
                  </div>
                </Link>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border first:border-t-0">
      <div className={cn("sticky top-0 bg-surface-2 px-3 py-1", "reos-label")}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
