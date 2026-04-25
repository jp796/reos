"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/app/ToastProvider";
import { RepresentationToggle } from "./RepresentationToggle";
import { AssigneePicker } from "./AssigneePicker";

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface Props {
  transactionId: string;
  status: string;
  transactionType: string;
  stageName: string | null;
  contactName: string;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  side: string | null;
  assignedUserId: string | null;
  team: TeamMember[];
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-brand-50 text-brand-700 ring-brand-200",
    pending: "bg-accent-100 text-accent-600 ring-accent-200",
    closed: "bg-surface-2 text-text-muted ring-border",
    dead: "bg-red-50 text-danger ring-red-200",
  };
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${map[status] ?? "bg-surface-2 text-text-muted ring-border"}`;
}

/**
 * Editable transaction header. Shows status badge + contact name +
 * address. Click the pencil to edit address / city / state / zip /
 * side / transactionType inline. Save writes via PATCH and refreshes.
 */
export function EditableHeader(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [address, setAddress] = useState(props.propertyAddress ?? "");
  const [city, setCity] = useState(props.city ?? "");
  const [state, setState] = useState(props.state ?? "");
  const [zip, setZip] = useState(props.zip ?? "");
  const [side, setSide] = useState(props.side ?? "");
  const [type, setType] = useState(props.transactionType);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/edit`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyAddress: address.trim() || null,
            city: city.trim() || null,
            state: state.trim() || null,
            zip: zip.trim() || null,
            side: side || null,
            transactionType: type,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        toast.error("Save failed", data.error ?? res.statusText);
        return;
      }
      // Flag the representation flip specifically — that's the change
      // with the most downstream blast radius (financials interpretation,
      // transaction list filter tabs, rescan defaults).
      const repChanged = (props.side ?? "") !== (side ?? "");
      const repLabel =
        side === "buy"
          ? "Buyer"
          : side === "sell"
            ? "Seller"
            : side === "both"
              ? "Dual"
              : null;
      if (repChanged && repLabel) {
        toast.success(
          `Representation: ${repLabel}`,
          "Saved — financials + filters will reflect the new side.",
        );
      } else {
        toast.success("Transaction updated");
      }
      setEditing(false);
      startTransition(() => router.refresh());
    } catch (e) {
      const m = e instanceof Error ? e.message : "save failed";
      setErr(m);
      toast.error("Save failed", m);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setAddress(props.propertyAddress ?? "");
    setCity(props.city ?? "");
    setState(props.state ?? "");
    setZip(props.zip ?? "");
    setSide(props.side ?? "");
    setType(props.transactionType);
    setErr(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={statusBadge(props.status)}>{props.status}</span>
          <span className="reos-label">{props.transactionType}</span>
          {/* Inline 1-click Representation toggle — flipping this
              updates side (+ transactionType when it was buyer/seller/
              empty) and fires downstream through Financials + filters. */}
          <RepresentationToggle
            transactionId={props.transactionId}
            side={props.side}
            transactionType={props.transactionType}
          />
          {/* Assigned coordinator — who's on point for this deal.
              Drives "my queue" filters on /today + /transactions. */}
          <AssigneePicker
            transactionId={props.transactionId}
            value={props.assignedUserId}
            team={props.team}
          />
          {props.stageName && (
            <span className="text-xs text-text-muted">
              · FUB: {props.stageName}
            </span>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-1 rounded p-1 text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
            title="Edit transaction metadata"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
        {/* Address is the H1 in <EditablePrimaryContact>. Show only the
            city/state/zip suffix here so the location still surfaces. */}
        {(props.city || props.state) && (
          <p className="mt-1 text-xs text-text-muted">
            {[props.city, props.state, props.zip].filter(Boolean).join(" ")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Edit transaction</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50",
            )}
          >
            <Check className="h-3 w-3" strokeWidth={2} />
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text"
          >
            <X className="h-3 w-3" strokeWidth={2} />
            Cancel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <label className="block sm:col-span-4">
          <span className="reos-label">Property address</span>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="12107 JK Trail"
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="reos-label">City</span>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="reos-label">State</span>
          <input
            type="text"
            value={state}
            onChange={(e) => setState(e.target.value)}
            maxLength={2}
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm uppercase"
          />
        </label>
        <label className="block">
          <span className="reos-label">Zip</span>
          <input
            type="text"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block sm:col-span-4">
          <span className="reos-label">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          >
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
            <option value="investor">Investor</option>
            <option value="wholesale">Wholesale</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      {err && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {err}
        </div>
      )}
    </div>
  );
}
