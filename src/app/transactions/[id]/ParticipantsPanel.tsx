"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  ArrowDown,
  Pencil,
  Plus,
  Star,
  Trash2,
  User,
  X,
  Check,
} from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import { VendorPicker } from "@/app/components/VendorPicker";

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
  co_buyer: "Buyer 2 (co-buyer)",
  co_seller: "Seller 2 (co-seller)",
  lender: "Lender",
  attorney: "Attorney",
  inspector: "Inspector",
  coordinator: "Coordinator",
  title: "Title / escrow",
  other: "Other",
};

/** Display group on the panel — buy-side parties cluster together,
 * sell-side together, services (lender / title / inspector / attorney)
 * together, everything else last. */
const ROLE_GROUP: Record<string, "buyer" | "seller" | "service" | "other"> = {
  co_buyer: "buyer",
  co_seller: "seller",
  lender: "service",
  title: "service",
  inspector: "service",
  attorney: "service",
  coordinator: "service",
  other: "other",
};

/**
 * Lists co-buyers / co-sellers / other parties on a transaction
 * (beyond the primary contact). Inline "+ Add" opens a mini-form
 * that either picks an existing contact (typeahead search) or
 * creates a new one from name/email/phone.
 */
export function ParticipantsPanel({
  transactionId,
  primaryContact,
  primarySide,
  initial,
}: {
  transactionId: string;
  primaryContact: {
    id: string;
    fullName: string;
    primaryEmail: string | null;
    primaryPhone: string | null;
  };
  primarySide: string | null;
  initial: Participant[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Participant[]>(initial);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Inline edit for any contact on this panel (name/email/phone).
   * Used by primary + every participant row, since the underlying
   * Contact PATCH endpoint is the same. */
  async function saveContactEdits(
    contactId: string,
    patch: {
      fullName?: string;
      primaryEmail?: string | null;
      primaryPhone?: string | null;
    },
  ) {
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    // Reflect locally so the row updates without a full reload.
    setItems((cur) =>
      cur.map((p) =>
        p.contact.id === contactId
          ? {
              ...p,
              contact: {
                ...p.contact,
                fullName: patch.fullName ?? p.contact.fullName,
                primaryEmail:
                  patch.primaryEmail !== undefined
                    ? patch.primaryEmail
                    : p.contact.primaryEmail,
                primaryPhone:
                  patch.primaryPhone !== undefined
                    ? patch.primaryPhone
                    : p.contact.primaryPhone,
              },
            }
          : p,
      ),
    );
    toast.success("Contact updated");
    startTransition(() => router.refresh());
    window.location.reload();
  }

  /** Reorder a participant relative to its same-role peers. The
   * server nudges createdAt by ±1ms past the neighbor; on refresh
   * the new order is reflected. */
  async function moveParticipant(pid: string, dir: "up" | "down") {
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/participants/${pid}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ move: dir }),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? res.statusText);
      }
      // Re-fetch from server so order matches DB.
      startTransition(() => router.refresh());
    window.location.reload();
      // Local re-order: swap the moved row with its neighbor in the
      // same role group so the UI updates instantly.
      setItems((cur) => {
        const sameRole = cur.filter(
          (p) => p.role === cur.find((q) => q.id === pid)?.role,
        );
        const idx = sameRole.findIndex((p) => p.id === pid);
        const swapWith = dir === "up" ? sameRole[idx - 1] : sameRole[idx + 1];
        if (!swapWith) return cur;
        return cur.map((p) =>
          p.id === pid
            ? { ...p, createdAt: swapWith.createdAt }
            : p.id === swapWith.id
              ? { ...p, createdAt: cur.find((q) => q.id === pid)!.createdAt }
              : p,
        );
      });
    } catch (e) {
      toast.error("Move failed", e instanceof Error ? e.message : "unknown");
    }
  }

  /** Promote a participant to "primary contact" of the transaction.
   * Swaps txn.primaryContactId to this participant's contact and
   * demotes the previous primary into a participant in the matching
   * role bucket (co_buyer if was buyer-side, co_seller if seller). */
  async function makePrimary(pid: string) {
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/participants/${pid}/promote`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success("Primary contact updated");
      startTransition(() => router.refresh());
    window.location.reload();
    } catch (e) {
      toast.error("Couldn't promote", e instanceof Error ? e.message : "unknown");
    }
  }

  /** Inline role edit — optimistic, falls back on error. */
  async function changeRole(pid: string, nextRole: string) {
    const prev = items.find((p) => p.id === pid)?.role ?? "other";
    if (prev === nextRole) return;
    setItems((cur) =>
      cur.map((p) => (p.id === pid ? { ...p, role: nextRole } : p)),
    );
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/participants/${pid}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? res.statusText);
      }
      toast.success(`Role: ${ROLE_LABELS[nextRole] ?? nextRole}`);
      startTransition(() => router.refresh());
    window.location.reload();
    } catch (e) {
      setItems((cur) =>
        cur.map((p) => (p.id === pid ? { ...p, role: prev } : p)),
      );
      toast.error(
        "Couldn't change role",
        e instanceof Error ? e.message : "unknown error",
      );
    }
  }

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
    window.location.reload();
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
    window.location.reload();
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

      {/* Parties — explicitly grouped by side so dual deals show
          Buyer 1/2 + Seller 1/2 cleanly, not a flat list. */}
      {(() => {
        // Bucket participants by group. Primary contact is the
        // "1" slot for whichever side they represent.
        const buyers = items.filter((p) => ROLE_GROUP[p.role] === "buyer");
        const sellers = items.filter((p) => ROLE_GROUP[p.role] === "seller");
        const services = items.filter((p) => ROLE_GROUP[p.role] === "service");
        const others = items.filter(
          (p) => !ROLE_GROUP[p.role] || ROLE_GROUP[p.role] === "other",
        );
        // On dual deals, the primary Contact is a single record — it
        // represents one human, not two. We anchor it to the BUYER
        // side (Buyer 1); the actual seller(s) are added as
        // co_seller participants and render as Seller 1, 2, …
        // Without this rule, Buyer 1 and Seller 1 would both point
        // at the same Contact id, so editing one would silently
        // mutate the other.
        const primaryIsBuy = primarySide === "buy" || primarySide === "both";
        const primaryIsSell = primarySide === "sell";

        return (
          <div className="space-y-3">
            {/* Buyer group */}
            {(primaryIsBuy || buyers.length > 0) && (
              <Group label="Buyer side">
                {primaryIsBuy && (
                  <PartyRow
                    name={primaryContact.fullName}
                    sub={
                      primaryContact.primaryEmail ??
                      primaryContact.primaryPhone ??
                      undefined
                    }
                    contactEmail={primaryContact.primaryEmail}
                    contactPhone={primaryContact.primaryPhone}
                    label="Buyer 1 · primary"
                    isPrimary
                    onEditContact={(patch) =>
                      saveContactEdits(primaryContact.id, patch)
                    }
                  />
                )}
                {buyers.map((p, i) => (
                  <PartyRow
                    key={p.id}
                    name={p.contact.fullName}
                    label={`Buyer ${i + (primaryIsBuy ? 2 : 1)}`}
                    sub={p.contact.primaryEmail ?? p.contact.primaryPhone ?? "—"}
                    notes={p.notes}
                    role={p.role}
                    contactEmail={p.contact.primaryEmail}
                    contactPhone={p.contact.primaryPhone}
                    canMoveUp={i > 0}
                    canMoveDown={i < buyers.length - 1}
                    onMoveUp={() => moveParticipant(p.id, "up")}
                    onMoveDown={() => moveParticipant(p.id, "down")}
                    onMakePrimary={() => makePrimary(p.id)}
                    onChangeRole={(r) => changeRole(p.id, r)}
                    onEditContact={(patch) => saveContactEdits(p.contact.id, patch)}
                    onRemove={() => remove(p.id)}
                  />
                ))}
              </Group>
            )}

            {/* Seller group */}
            {(primaryIsSell || sellers.length > 0) && (
              <Group label="Seller side">
                {primaryIsSell && (
                  <PartyRow
                    name={primaryContact.fullName}
                    sub={
                      primaryContact.primaryEmail ??
                      primaryContact.primaryPhone ??
                      undefined
                    }
                    contactEmail={primaryContact.primaryEmail}
                    contactPhone={primaryContact.primaryPhone}
                    label="Seller 1 · primary"
                    isPrimary
                    onEditContact={(patch) =>
                      saveContactEdits(primaryContact.id, patch)
                    }
                  />
                )}
                {sellers.map((p, i) => (
                  <PartyRow
                    key={p.id}
                    name={p.contact.fullName}
                    label={`Seller ${i + (primaryIsSell ? 2 : 1)}`}
                    sub={p.contact.primaryEmail ?? p.contact.primaryPhone ?? "—"}
                    notes={p.notes}
                    role={p.role}
                    contactEmail={p.contact.primaryEmail}
                    contactPhone={p.contact.primaryPhone}
                    canMoveUp={i > 0}
                    canMoveDown={i < sellers.length - 1}
                    onMoveUp={() => moveParticipant(p.id, "up")}
                    onMoveDown={() => moveParticipant(p.id, "down")}
                    onMakePrimary={() => makePrimary(p.id)}
                    onChangeRole={(r) => changeRole(p.id, r)}
                    onEditContact={(patch) => saveContactEdits(p.contact.id, patch)}
                    onRemove={() => remove(p.id)}
                  />
                ))}
              </Group>
            )}

            {/* Services (lender / title / inspector / attorney) */}
            {services.length > 0 && (
              <Group label="Services">
                {services.map((p) => (
                  <PartyRow
                    key={p.id}
                    name={p.contact.fullName}
                    label={ROLE_LABELS[p.role] ?? p.role}
                    sub={p.contact.primaryEmail ?? p.contact.primaryPhone ?? "—"}
                    notes={p.notes}
                    role={p.role}
                    contactEmail={p.contact.primaryEmail}
                    contactPhone={p.contact.primaryPhone}
                    onChangeRole={(r) => changeRole(p.id, r)}
                    onEditContact={(patch) => saveContactEdits(p.contact.id, patch)}
                    onRemove={() => remove(p.id)}
                  />
                ))}
              </Group>
            )}

            {/* Other / unclassified */}
            {others.length > 0 && (
              <Group label="Other">
                {others.map((p) => (
                  <PartyRow
                    key={p.id}
                    name={p.contact.fullName}
                    label={ROLE_LABELS[p.role] ?? p.role}
                    sub={p.contact.primaryEmail ?? p.contact.primaryPhone ?? "—"}
                    notes={p.notes}
                    role={p.role}
                    contactEmail={p.contact.primaryEmail}
                    contactPhone={p.contact.primaryPhone}
                    onChangeRole={(r) => changeRole(p.id, r)}
                    onEditContact={(patch) => saveContactEdits(p.contact.id, patch)}
                    onRemove={() => remove(p.id)}
                  />
                ))}
              </Group>
            )}
          </div>
        );
      })()}

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
                {role === "title" || role === "lender" || role === "inspector" || role === "attorney" ? (
                  <VendorPicker
                    category={role as "title" | "lender" | "inspector" | "attorney"}
                    value={fullName}
                    onChange={setFullName}
                    placeholder={`Existing ${role} or new name`}
                  />
                ) : (
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full name"
                    className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
                  />
                )}
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

/** Visual section header for a parties group (Buyer side / Seller side / Services / Other). */
function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="reos-label mb-1.5">{label}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Single party row — used for primary contact AND every participant
 * row. The pencil icon opens an inline form for name/email/phone;
 * the upstream callback decides which Contact id to PATCH. */
function PartyRow({
  name,
  label,
  sub,
  notes,
  isPrimary,
  role,
  onChangeRole,
  onRemove,
  onEditContact,
  contactEmail,
  contactPhone,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onMakePrimary,
}: {
  name: string;
  label: string;
  sub?: string;
  notes?: string | null;
  isPrimary?: boolean;
  role?: string;
  onChangeRole?: (next: string) => void;
  onRemove?: () => void;
  onEditContact?: (patch: {
    fullName?: string;
    primaryEmail?: string | null;
    primaryPhone?: string | null;
  }) => Promise<void>;
  contactEmail?: string | null;
  contactPhone?: string | null;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMakePrimary?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftEmail, setDraftEmail] = useState(contactEmail ?? "");
  const [draftPhone, setDraftPhone] = useState(contactPhone ?? "");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraftName(name);
    setDraftEmail(contactEmail ?? "");
    setDraftPhone(contactPhone ?? "");
    setEditing(true);
  }

  async function save() {
    if (!onEditContact) return;
    setSaving(true);
    try {
      await onEditContact({
        fullName: draftName,
        primaryEmail: draftEmail.trim() || null,
        primaryPhone: draftPhone.trim() || null,
      });
      setEditing(false);
    } catch {
      // toast already shown upstream
    } finally {
      setSaving(false);
    }
  }

  if (editing && onEditContact) {
    return (
      <div className="rounded-md border border-brand-300 bg-brand-50/40 px-3 py-2 text-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Full name"
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
          />
          <input
            type="email"
            value={draftEmail}
            onChange={(e) => setDraftEmail(e.target.value)}
            placeholder="Email"
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
          />
          <input
            type="tel"
            value={draftPhone}
            onChange={(e) => setDraftPhone(e.target.value)}
            placeholder="Phone"
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || !draftName.trim()}
            className="inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <Check className="h-3 w-3" strokeWidth={2} />
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs hover:border-border-strong"
          >
            <X className="h-3 w-3" strokeWidth={2} />
            Cancel
          </button>
          <span className="ml-auto text-[11px] text-text-subtle">
            Edits apply to this contact everywhere it&rsquo;s referenced.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm " +
        (isPrimary
          ? "border-brand-200 bg-brand-50/40"
          : "border-border bg-surface")
      }
    >
      <User
        className={
          "h-3.5 w-3.5 " + (isPrimary ? "text-brand-600" : "text-text-muted")
        }
        strokeWidth={1.8}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-text">{name}</span>
          {role && onChangeRole ? (
            <select
              value={role in ROLE_LABELS ? role : "other"}
              onChange={(e) => onChangeRole(e.target.value)}
              className="rounded border border-border bg-accent-50 px-1.5 py-0.5 text-[11px] font-medium text-accent-700 focus:border-accent-400 focus:outline-none"
              title="Change this participant's role"
            >
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          ) : (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
              {label}
            </span>
          )}
        </div>
        {sub && (
          <div className="text-xs text-text-muted">
            {sub}
            {notes && <> · {notes}</>}
          </div>
        )}
      </div>
      {onMoveUp && canMoveUp && (
        <button
          type="button"
          onClick={onMoveUp}
          className="rounded p-1 text-text-subtle hover:bg-surface-2 hover:text-text"
          title="Move up (lower number)"
        >
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}
      {onMoveDown && canMoveDown && (
        <button
          type="button"
          onClick={onMoveDown}
          className="rounded p-1 text-text-subtle hover:bg-surface-2 hover:text-text"
          title="Move down (higher number)"
        >
          <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}
      {onMakePrimary && (
        <button
          type="button"
          onClick={onMakePrimary}
          className="rounded p-1 text-text-subtle hover:bg-surface-2 hover:text-amber-600"
          title="Make this the primary contact for the transaction"
        >
          <Star className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}
      {onEditContact && (
        <button
          type="button"
          onClick={startEdit}
          className="rounded p-1 text-text-subtle hover:bg-surface-2 hover:text-brand-700"
          title="Edit contact (name / email / phone)"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-text-subtle hover:bg-surface-2 hover:text-danger"
          title="Remove from transaction"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}
