"use client";

/**
 * PartiesQuickEdit — 2×2 grid of Buyer 1/2 + Seller 1/2 directly
 * under the transaction header. Each slot is independently editable
 * (name / email / phone) and empty slots show a "+ Add" affordance
 * that opens an inline form.
 *
 * Slot derivation:
 *   - Buyer 1 = primary contact (when side=buy/both) ELSE first co_buyer
 *   - Buyer 2 = first co_buyer (when Buyer 1 is primary) ELSE second co_buyer
 *   - Seller 1 = primary contact (when side=sell) ELSE first co_seller
 *   - Seller 2 = first co_seller (when Seller 1 is primary) ELSE second co_seller
 *
 * Note: this is a quick-access duplicate of ParticipantsPanel — both
 * exist on the page and write to the same endpoints, so changes here
 * are reflected below on refresh.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X, Check } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Contact {
  id: string;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
}
interface Participant {
  id: string;
  role: string;
  contact: Contact;
}
interface Slot {
  /** "primary" → maps to txn.contactId; "participant" → TransactionParticipant row */
  source: "primary" | "participant" | "empty";
  /** participant id (when source=participant) */
  participantId?: string;
  contact?: Contact;
  /** for an empty slot, the role we'll add the new contact under */
  addRole: "co_buyer" | "co_seller";
}

export function PartiesQuickEdit({
  transactionId,
  primaryContact,
  side,
  participants,
}: {
  transactionId: string;
  primaryContact: Contact;
  side: string | null;
  participants: Participant[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const coBuyers = participants
    .filter((p) => p.role === "co_buyer")
    .sort((a, b) => a.contact.fullName.localeCompare(b.contact.fullName));
  const coSellers = participants.filter((p) => p.role === "co_seller");

  const primaryIsBuy = side === "buy" || side === "both";
  const primaryIsSell = side === "sell";

  const slots: { label: string; slot: Slot }[] = [
    {
      label: "Buyer 1",
      slot: primaryIsBuy
        ? { source: "primary", contact: primaryContact, addRole: "co_buyer" }
        : coBuyers[0]
          ? {
              source: "participant",
              participantId: coBuyers[0].id,
              contact: coBuyers[0].contact,
              addRole: "co_buyer",
            }
          : { source: "empty", addRole: "co_buyer" },
    },
    {
      label: "Buyer 2",
      slot: (() => {
        const list = primaryIsBuy ? coBuyers : coBuyers.slice(1);
        const p = list[0];
        return p
          ? {
              source: "participant",
              participantId: p.id,
              contact: p.contact,
              addRole: "co_buyer",
            }
          : { source: "empty", addRole: "co_buyer" };
      })(),
    },
    {
      label: "Seller 1",
      slot: primaryIsSell
        ? { source: "primary", contact: primaryContact, addRole: "co_seller" }
        : coSellers[0]
          ? {
              source: "participant",
              participantId: coSellers[0].id,
              contact: coSellers[0].contact,
              addRole: "co_seller",
            }
          : { source: "empty", addRole: "co_seller" },
    },
    {
      label: "Seller 2",
      slot: (() => {
        const list = primaryIsSell ? coSellers : coSellers.slice(1);
        const p = list[0];
        return p
          ? {
              source: "participant",
              participantId: p.id,
              contact: p.contact,
              addRole: "co_seller",
            }
          : { source: "empty", addRole: "co_seller" };
      })(),
    },
  ];

  async function saveContact(
    contactId: string,
    patch: { fullName: string; primaryEmail: string | null; primaryPhone: string | null },
  ) {
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    toast.success("Saved", patch.fullName);
    startTransition(() => router.refresh());
  }

  async function addParticipant(
    role: "co_buyer" | "co_seller",
    payload: { fullName: string; email: string; phone: string },
  ) {
    const res = await fetch(`/api/transactions/${transactionId}/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role,
        fullName: payload.fullName.trim(),
        email: payload.email.trim() || null,
        phone: payload.phone.trim() || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    toast.success("Added", payload.fullName);
    startTransition(() => router.refresh());
  }

  async function removeParticipant(pid: string) {
    if (!window.confirm("Remove this party from the transaction?")) return;
    const res = await fetch(
      `/api/transactions/${transactionId}/participants/${pid}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error("Couldn't remove", d.error ?? res.statusText);
      return;
    }
    toast.success("Removed");
    startTransition(() => router.refresh());
  }

  return (
    <section className="mt-4 rounded-md border border-border bg-surface p-3">
      <div className="reos-label mb-2">Parties</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {slots.map(({ label, slot }) => (
          <SlotCard
            key={label}
            label={label}
            slot={slot}
            onSaveContact={saveContact}
            onAdd={(payload) => addParticipant(slot.addRole, payload)}
            onRemoveParticipant={
              slot.source === "participant" && slot.participantId
                ? () => removeParticipant(slot.participantId!)
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

function SlotCard({
  label,
  slot,
  onSaveContact,
  onAdd,
  onRemoveParticipant,
}: {
  label: string;
  slot: Slot;
  onSaveContact: (
    contactId: string,
    patch: { fullName: string; primaryEmail: string | null; primaryPhone: string | null },
  ) => Promise<void>;
  onAdd: (payload: { fullName: string; email: string; phone: string }) => Promise<void>;
  onRemoveParticipant?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const c = slot.contact;
  const [name, setName] = useState(c?.fullName ?? "");
  const [email, setEmail] = useState(c?.primaryEmail ?? "");
  const [phone, setPhone] = useState(c?.primaryPhone ?? "");

  function startEdit() {
    setName(c?.fullName ?? "");
    setEmail(c?.primaryEmail ?? "");
    setPhone(c?.primaryPhone ?? "");
    setEditing(true);
  }

  async function save() {
    if (!c?.id) return;
    setBusy(true);
    try {
      await onSaveContact(c.id, {
        fullName: name,
        primaryEmail: email.trim() || null,
        primaryPhone: phone.trim() || null,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onAdd({ fullName: name, email, phone });
      setAdding(false);
      setName("");
      setEmail("");
      setPhone("");
    } catch (e) {
      // toast handled upstream
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (editing || adding) {
    const isAdd = adding;
    return (
      <div className="rounded-md border border-brand-300 bg-brand-50/40 p-2">
        <div className="reos-label mb-1.5">{label}</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={isAdd ? add : save}
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <Check className="h-3 w-3" strokeWidth={2} />
            {busy ? "Saving…" : isAdd ? "Add" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setAdding(false);
            }}
            className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs hover:border-border-strong"
          >
            <X className="h-3 w-3" strokeWidth={2} />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (slot.source === "empty") {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex items-center justify-between rounded-md border border-dashed border-border bg-surface-2/40 p-2 text-left text-sm text-text-muted hover:border-brand-500 hover:bg-brand-50/40 hover:text-brand-700"
      >
        <span>
          <span className="reos-label mr-1.5">{label}</span>
          <span className="text-text-subtle">empty</span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium">
          <Plus className="h-3 w-3" strokeWidth={2} /> Add
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="reos-label">{label}</div>
          <div className="truncate font-medium text-text">{c?.fullName ?? "—"}</div>
          {(c?.primaryEmail || c?.primaryPhone) && (
            <div className="truncate text-xs text-text-muted">
              {c?.primaryEmail ?? c?.primaryPhone}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={startEdit}
            className="rounded p-1 text-text-subtle hover:bg-surface-2 hover:text-brand-700"
            title="Edit name / email / phone"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          {onRemoveParticipant && (
            <button
              type="button"
              onClick={onRemoveParticipant}
              className="rounded p-1 text-text-subtle hover:bg-surface-2 hover:text-danger"
              title="Remove from transaction"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
