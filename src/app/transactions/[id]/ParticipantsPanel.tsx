"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, User } from "lucide-react";

interface Contact {
  id: string;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
}
interface Participant {
  id: string;
  role: string;
  notes: string | null;
  createdAt: string;
  contact: Contact;
}

const ROLE_LABELS: Record<string, string> = {
  co_buyer: "Co-buyer",
  co_seller: "Co-seller",
  lender: "Lender",
  attorney: "Attorney",
  inspector: "Inspector",
  coordinator: "Coordinator",
  other: "Other",
};

/**
 * Lists co-buyers / co-sellers / other parties on a transaction
 * (beyond the primary contact). Inline "+ Add" opens a mini-form
 * that either picks an existing contact (typeahead search) or
 * creates a new one from name/email/phone.
 */
export function ParticipantsPanel({
  transactionId,
  primaryContactName,
  primarySide,
  initial,
}: {
  transactionId: string;
  primaryContactName: string;
  primarySide: string | null;
  initial: Participant[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Participant[]>(initial);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const defaultRole =
    primarySide === "buy" ? "co_buyer" : primarySide === "sell" ? "co_seller" : "co_buyer";
  const [role, setRole] = useState(defaultRole);
  const [notes, setNotes] = useState("");

  // Typeahead contact search
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupHits, setLookupHits] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  async function doLookup(q: string) {
    setLookupQuery(q);
    if (q.trim().length < 2) {
      setLookupHits([]);
      return;
    }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setLookupHits(
        (data.contacts ?? []).slice(0, 6).map((c: Contact) => c),
      );
    } catch {
      // ignore
    }
  }

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { role, notes: notes.trim() || null };
      if (selectedContactId) {
        body.contactId = selectedContactId;
      } else {
        if (!fullName.trim()) {
          setErr("pick an existing contact OR enter a name for a new one");
          return;
        }
        body.fullName = fullName.trim();
        body.email = email.trim() || null;
        body.phone = phone.trim() || null;
      }
      const res = await fetch(
        `/api/transactions/${transactionId}/participants`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setItems((prev) => [...prev, data.participant]);
      resetForm();
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "add failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(pid: string) {
    if (!window.confirm("Remove this participant? (contact record stays.)")) return;
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/participants/${pid}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json();
        setErr(data.error ?? res.statusText);
        return;
      }
      setItems((prev) => prev.filter((p) => p.id !== pid));
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "remove failed");
    }
  }

  function resetForm() {
    setFullName("");
    setEmail("");
    setPhone("");
    setNotes("");
    setRole(defaultRole);
    setLookupQuery("");
    setLookupHits([]);
    setSelectedContactId(null);
    setAdding(false);
    setErr(null);
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          Additional parties{" "}
          <span className="font-normal text-text-muted">
            · {items.length}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium hover:border-brand-500 hover:text-brand-700"
        >
          {adding ? "Cancel" : "+ Add party"}
        </button>
      </div>

      {/* Primary-contact row (read-only, for context) */}
      <div className="mb-2 flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs">
        <User className="h-3.5 w-3.5 text-brand-600" strokeWidth={1.8} />
        <span className="font-medium text-text">{primaryContactName}</span>
        <span className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">
          {primarySide === "buy" ? "Primary buyer" : primarySide === "sell" ? "Primary seller" : "Primary"}
        </span>
      </div>

      {/* Participant rows */}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <User className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text">
                    {p.contact.fullName}
                  </span>
                  <span className="rounded bg-accent-100 px-1.5 py-0.5 text-[11px] font-medium text-accent-600">
                    {ROLE_LABELS[p.role] ?? p.role}
                  </span>
                </div>
                <div className="text-xs text-text-muted">
                  {p.contact.primaryEmail ?? p.contact.primaryPhone ?? "—"}
                  {p.notes && <> · {p.notes}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="rounded p-1 text-text-subtle hover:bg-surface-2 hover:text-danger"
                title="Remove from transaction"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      {adding && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-surface-2 p-3">
          <div className="space-y-2">
            <label className="block">
              <span className="reos-label">Search existing contact</span>
              <input
                type="text"
                value={lookupQuery}
                onChange={(e) => doLookup(e.target.value)}
                placeholder="name, email, phone…"
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            {lookupHits.length > 0 && (
              <div className="rounded border border-border bg-surface">
                {lookupHits.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedContactId(c.id);
                      setLookupQuery(c.fullName);
                      setLookupHits([]);
                      setFullName("");
                      setEmail("");
                      setPhone("");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                  >
                    <User className="h-3 w-3 text-text-muted" strokeWidth={1.8} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-text">
                        {c.fullName}
                      </div>
                      <div className="truncate text-xs text-text-muted">
                        {c.primaryEmail ?? c.primaryPhone ?? "—"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selectedContactId && (
              <div className="text-xs text-text-muted">
                Using existing contact.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedContactId(null);
                    setLookupQuery("");
                  }}
                  className="underline hover:text-text"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {!selectedContactId && (
            <div className="border-t border-border pt-2">
              <div className="reos-label mb-1">Or add new contact</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Full name"
                  className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
                />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone"
                  className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr_auto]">
            <label className="block">
              <span className="reos-label">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              >
                {Object.entries(ROLE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="reos-label">Notes (optional)</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. spouse, LLC member"
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={add}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
          </div>

          {err && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
              {err}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
