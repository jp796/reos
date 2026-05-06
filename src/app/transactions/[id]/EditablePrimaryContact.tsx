"use client";

/**
 * Click-to-edit primary contact for a transaction.
 *
 * Sits under the header status/rep badges, replaces the static
 * `<h1>{contact.fullName}</h1>`. Clicking the pencil opens a mini
 * form with name / email / phone. Save writes via PATCH /api/contacts/:id.
 *
 * Why this exists separately from `EditableHeader`:
 * - Editing the contact is semantically distinct from editing the
 *   transaction row. Renaming the contact propagates anywhere that
 *   contact is referenced, so we surface that via a dedicated affordance.
 * - When the contact is a company (name includes LLC / Inc / Corp),
 *   we show a subtle reminder to add the natural-person signer as
 *   a co_seller / co_buyer participant below.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  Check,
  X,
  Building2,
  DollarSign,
  Percent,
  CalendarDays,
  Users,
  Home,
} from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Props {
  contactId: string;
  fullName: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  /** True if this contact is referenced on more than just this txn.
   * Used to warn the user that renaming propagates beyond here. */
  referencedElsewhere: boolean;
  /** Which side the transaction represents — drives the "add a
   * natural-person signer" copy when the name looks like a company. */
  side: string | null;
  /** Property address — rendered as the H1 above party names. */
  propertyAddress: string | null;
  /** Buyer-side party names (primary on buy, plus any co_buyers). */
  buyerNames: string[];
  /** Seller-side party names (primary on sell, plus any co_sellers). */
  sellerNames: string[];
  /** Compact "at-a-glance" facts surfaced under the address — saves a
   * scroll for the numbers Vicki checks the most. */
  salePrice?: number | null;
  commissionPercent?: number | null;
  grossCommission?: number | null;
  contractDate?: Date | null;
  closingDate?: Date | null;
}

function fmtMoney(n: number | null | undefined): string | null {
  if (n == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
function fmtDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function sideLabel(side: string | null): string {
  if (side === "buy") return "Buy Side";
  if (side === "sell") return "Sell Side";
  if (side === "both") return "Dual Agency";
  return "—";
}

const COMPANY_RE = /\b(llc|inc|corp|co|company|properties|holdings|trust|ltd|pllc|pc)\b\.?/i;

export function EditablePrimaryContact(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const [fullName, setFullName] = useState(props.fullName);
  const [email, setEmail] = useState(props.primaryEmail ?? "");
  const [phone, setPhone] = useState(props.primaryPhone ?? "");
  const [err, setErr] = useState<string | null>(null);

  const isCompany = COMPANY_RE.test(props.fullName);

  async function save() {
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/contacts/${props.contactId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fullName,
            primaryEmail: email.trim() || null,
            primaryPhone: phone.trim() || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErr(data.error ?? res.statusText);
          toast.error("Save failed", data.error ?? res.statusText);
          return;
        }
        toast.success("Contact updated", fullName);
        setEditing(false);
        router.refresh();
      } catch (e) {
        const m = e instanceof Error ? e.message : "save failed";
        setErr(m);
        toast.error("Save failed", m);
      }
    });
  }

  function cancel() {
    setFullName(props.fullName);
    setEmail(props.primaryEmail ?? "");
    setPhone(props.primaryPhone ?? "");
    setErr(null);
    setEditing(false);
  }

  if (!editing) {
    const sideWord =
      props.side === "sell"
        ? "seller"
        : props.side === "buy"
          ? "buyer"
          : "party";
    const priceStr = fmtMoney(props.salePrice);
    const grossStr = fmtMoney(props.grossCommission);
    const contractStr = fmtDate(props.contractDate);
    const closingStr = fmtDate(props.closingDate);
    return (
      <div className="mt-2">
        {/* Address is the transaction's headline. Names live underneath,
            split by side when the deal is dual. */}
        <div className="flex items-start gap-2">
          <h1 className="font-display text-display-md font-semibold">
            {props.propertyAddress ?? "No property address yet"}
          </h1>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 rounded p-1 text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
            title="Edit primary contact (name / email / phone)"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>

        {/* At-a-glance summary chips — sale price, side, commission. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {priceStr && (
            <span className="inline-flex items-center gap-1 font-semibold text-text">
              <DollarSign className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
              {priceStr}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
            <Home className="h-3 w-3" strokeWidth={2} />
            {sideLabel(props.side)}
          </span>
          {props.commissionPercent != null && (
            <span className="inline-flex items-center gap-1 text-text-muted">
              <Percent className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="font-medium text-text">
                {props.commissionPercent}%
              </span>
              {grossStr && <span className="text-text-muted">| {grossStr}</span>}
            </span>
          )}
          {contractStr && (
            <span className="inline-flex items-center gap-1 text-text-muted">
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={2} />
              <span>Contract</span>
              <span className="font-medium text-text">{contractStr}</span>
            </span>
          )}
          {closingStr && (
            <span className="inline-flex items-center gap-1 text-text-muted">
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={2} />
              <span>Closing</span>
              <span className="font-medium text-text">{closingStr}</span>
            </span>
          )}
        </div>

        {/* Buyer / Seller name rows — always shown so dual deals see
            both sides; non-dual transactions still surface the side
            they're representing. */}
        <div className="mt-2 space-y-0.5 text-sm">
          {props.buyerNames.length > 0 && (
            <div className="flex items-baseline gap-1.5">
              <Users className="h-3.5 w-3.5 translate-y-0.5 text-text-muted" strokeWidth={2} />
              <span className="reos-label">Buyer/Tenant</span>
              <span className="font-medium text-text">
                {props.buyerNames.join(", ")}
              </span>
            </div>
          )}
          {props.sellerNames.length > 0 && (
            <div className="flex items-baseline gap-1.5">
              <Users className="h-3.5 w-3.5 translate-y-0.5 text-text-muted" strokeWidth={2} />
              <span className="reos-label">Seller/Landlord</span>
              <span className="font-medium text-text">
                {props.sellerNames.join(", ")}
              </span>
            </div>
          )}
        </div>

        {isCompany && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
            <Building2 className="h-3 w-3" strokeWidth={1.8} />
            This {sideWord} is a company. Add the natural person signing
            for it below as a <b>co-{sideWord}</b> participant.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Edit primary contact</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <Check className="h-3 w-3" strokeWidth={2} />
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text"
          >
            <X className="h-3 w-3" strokeWidth={2} />
            Cancel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block sm:col-span-3">
          <span className="reos-label">Full name / entity</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Garland Properties LLC"
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="reos-label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="signer@company.com"
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="reos-label">Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="555-555-5555"
            className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {props.referencedElsewhere && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/40 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠︎ This contact is linked to other transactions too — the
          rename will show up everywhere. If you want a different entity
          here only, cancel and add a new participant instead.
        </div>
      )}

      {err && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/40 px-2 py-1.5 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}
    </div>
  );
}
