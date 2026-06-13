"use client";

/**
 * ContactAutocomplete — typeahead over the account's existing
 * contacts, with a "use what I typed as a new contact" escape hatch.
 *
 * Drop it anywhere a name field should be able to PULL FROM CONTACTS
 * (buyers, sellers, etc.). On pick of an existing contact it calls
 * onSelect with that contact's name/email/phone so the parent can
 * fill sibling fields. On free-text it just reports the typed name
 * via onChange (and onSelect(null) so the parent knows it's a new
 * person, not a linked contact).
 *
 * Backed by GET /api/contacts/search?q= (tenant-scoped).
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, UserPlus, Check } from "lucide-react";

export interface ContactHit {
  id: string;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  sourceName: string | null;
}

interface Props {
  /** Current text value (the name). */
  value: string;
  onChange: (name: string) => void;
  /** Fired when the user picks an existing contact (full row) or
   *  clears the link by typing free text (null). */
  onSelect: (hit: ContactHit | null) => void;
  placeholder?: string;
  /** Marks the field red after a failed required-submit. */
  invalid?: boolean;
  /** data-field tag so the parent's scroll-to-error can find it. */
  fieldKey?: string;
}

export function ContactAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  invalid,
  fieldKey,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function search(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/contacts/search?q=${encodeURIComponent(q)}&limit=8`,
        );
        const b = (await res.json()) as { items?: ContactHit[] };
        setHits(b.items ?? []);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 220);
  }

  function handleChange(next: string) {
    onChange(next);
    // Typing breaks any existing link — the parent should treat this
    // as a new/edited person until they pick from the list again.
    if (linkedId) {
      setLinkedId(null);
      onSelect(null);
    }
    setOpen(true);
    search(next);
  }

  function pick(hit: ContactHit) {
    onChange(hit.fullName);
    setLinkedId(hit.id);
    onSelect(hit);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative" data-field={fieldKey}>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => {
            setOpen(true);
            if (hits.length === 0) search(value);
          }}
          placeholder={placeholder}
          className={`w-full rounded border px-2.5 py-1.5 pr-7 text-sm text-text placeholder:text-text-subtle focus:outline-none ${
            invalid
              ? "border-red-400 bg-red-50 focus:border-red-500"
              : "border-border bg-surface-2 focus:border-brand-500"
          }`}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
          {linkedId ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
          ) : loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-subtle" />
          ) : (
            <Search className="h-3.5 w-3.5 text-text-subtle" strokeWidth={2} />
          )}
        </span>
      </div>

      {open && (value.length > 0 || hits.length > 0) && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface shadow-lg">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => pick(h)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-text">{h.fullName}</div>
                <div className="truncate text-xs text-text-muted">
                  {[h.primaryEmail, h.primaryPhone].filter(Boolean).join(" · ") ||
                    h.sourceName ||
                    "no contact info"}
                </div>
              </div>
            </button>
          ))}
          {hits.length === 0 && !loading && (
            <div className="px-3 py-2 text-xs text-text-muted">
              No matching contacts.
            </div>
          )}
          {value.trim().length > 0 && (
            <button
              type="button"
              onClick={() => {
                // Keep the typed name; explicitly a NEW person.
                setLinkedId(null);
                onSelect(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50"
            >
              <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
              Add &ldquo;{value.trim()}&rdquo; as a new contact
            </button>
          )}
        </div>
      )}
    </div>
  );
}
