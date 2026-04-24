"use client";

/**
 * VendorPicker — typeahead autocomplete backed by /api/vendors. Lets
 * the user pick from past vendors (title companies, lenders, etc.) by
 * name instead of re-typing. Returns the selected name via onChange.
 *
 * The dropdown shows the top 50 by usage count for the given category.
 * Typing narrows the list. Users can still type a free-text value not
 * in the list and press enter / tab — we treat typed-but-not-picked
 * as a new vendor and pass it through.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface Vendor {
  contactId: string;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  dealCount: number;
  lastUsedAt: string;
}

export function VendorPicker({
  category,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  category: "title" | "lender" | "inspector" | "attorney";
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const lastFetchedFor = useRef<string>("");

  useEffect(() => {
    if (!focused) return;
    const key = `${category}|${value}`;
    if (lastFetchedFor.current === key) return;
    lastFetchedFor.current = key;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const url = `/api/vendors?category=${category}&q=${encodeURIComponent(value)}`;
        const res = await fetch(url);
        const data = await res.json();
        setHits(data.items ?? []);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [category, value, focused]);

  return (
    <div className={cn("relative", className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
      />
      {focused && (hits.length > 0 || loading) && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {loading && hits.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-muted">searching…</div>
          )}
          {hits.map((v) => (
            <button
              key={v.contactId}
              type="button"
              onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur fires after click
              onClick={() => {
                onChange(v.fullName);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-text">
                  {v.fullName}
                </span>
                <span className="block truncate text-[10px] text-text-muted">
                  {v.primaryEmail ?? v.primaryPhone ?? "—"}
                </span>
              </span>
              <span
                className="shrink-0 rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-medium text-accent-700"
                title={`Last used ${new Date(v.lastUsedAt).toLocaleDateString()}`}
              >
                {v.dealCount}× used
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
