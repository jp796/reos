"use client";

/**
 * OtherSidePanel — the co-op (other-side) agent + title company contact block.
 * Auto-filled from the contract and from title/co-op emails (enrich-only), and
 * fully editable so a wrong auto-fill can be corrected. This is the deal's
 * system-of-record for who's on the other side of the table.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Handshake, Landmark, Banknote, Phone, Mail, Pencil, Check, X } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export interface OtherSideData {
  coAgentName: string | null;
  coAgentBrokerage: string | null;
  coAgentPhone: string | null;
  coAgentEmail: string | null;
  coAgentLicense: string | null;
  titleCompanyName: string | null;
  titleCompanyContact: string | null;
  titleCompanyPhone: string | null;
  titleCompanyEmail: string | null;
  lenderName: string | null;
  lenderCompany: string | null;
  lenderPhone: string | null;
  lenderEmail: string | null;
}

const FIELDS: Array<{ key: keyof OtherSideData; label: string; group: "agent" | "title" | "lender" }> = [
  { key: "coAgentName", label: "Agent name", group: "agent" },
  { key: "coAgentBrokerage", label: "Brokerage", group: "agent" },
  { key: "coAgentPhone", label: "Phone", group: "agent" },
  { key: "coAgentEmail", label: "Email", group: "agent" },
  { key: "coAgentLicense", label: "License #", group: "agent" },
  { key: "titleCompanyName", label: "Title company", group: "title" },
  { key: "titleCompanyContact", label: "Closer / contact", group: "title" },
  { key: "titleCompanyPhone", label: "Phone", group: "title" },
  { key: "titleCompanyEmail", label: "Email", group: "title" },
  { key: "lenderName", label: "Loan officer", group: "lender" },
  { key: "lenderCompany", label: "Company", group: "lender" },
  { key: "lenderPhone", label: "Phone", group: "lender" },
  { key: "lenderEmail", label: "Email", group: "lender" },
];

const GROUP_LABEL: Record<"agent" | "title" | "lender", string> = {
  agent: "Co-op agent · ",
  title: "Title · ",
  lender: "Lender · ",
};

export function OtherSidePanel({
  transactionId,
  data,
}: {
  transactionId: string;
  data: OtherSideData;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OtherSideData>(data);
  const [busy, setBusy] = useState(false);

  const hasAny = FIELDS.some((f) => data[f.key]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        toast.error("Couldn't save", (await res.json().catch(() => null))?.error);
        return;
      }
      toast.success("Saved");
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Handshake className="h-4 w-4 text-text-muted" strokeWidth={1.8} />
          Other side, title &amp; lender
        </h2>
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(data);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-muted hover:border-brand-400 hover:text-brand-700"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        ) : (
          <span className="flex gap-1">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <Check className="h-3 w-3" /> Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      {editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="reos-label mb-1 block text-text-subtle">
                {GROUP_LABEL[f.group]}
                {f.label}
              </span>
              <input
                value={draft[f.key] ?? ""}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                className="reos-input"
              />
            </label>
          ))}
        </div>
      ) : !hasAny ? (
        <p className="text-sm text-text-muted">
          No other-side contact yet. It auto-fills from the contract and from title / co-op agent
          emails on <span className="font-medium">Re-sync from sources</span> — or click Edit to add it.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ContactCard
            icon={<Handshake className="h-4 w-4" />}
            title="Co-op agent (other side)"
            name={data.coAgentName}
            sub={[data.coAgentBrokerage, data.coAgentLicense ? `Lic ${data.coAgentLicense}` : null]
              .filter(Boolean)
              .join(" · ")}
            phone={data.coAgentPhone}
            email={data.coAgentEmail}
          />
          <ContactCard
            icon={<Landmark className="h-4 w-4" />}
            title="Title company"
            name={data.titleCompanyName}
            sub={data.titleCompanyContact}
            phone={data.titleCompanyPhone}
            email={data.titleCompanyEmail}
          />
          <ContactCard
            icon={<Banknote className="h-4 w-4" />}
            title="Lender"
            name={data.lenderName ?? data.lenderCompany}
            sub={data.lenderName ? data.lenderCompany : null}
            phone={data.lenderPhone}
            email={data.lenderEmail}
          />
        </div>
      )}
    </section>
  );
}

function ContactCard({
  icon,
  title,
  name,
  sub,
  phone,
  email,
}: {
  icon: React.ReactNode;
  title: string;
  name: string | null;
  sub: string | null;
  phone: string | null;
  email: string | null;
}) {
  if (!name && !sub && !phone && !email) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-sm text-text-subtle">
        <span className="flex items-center gap-1.5 text-text-muted">{icon} {title}</span>
        <div className="mt-1">—</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border p-3">
      <div className="reos-label flex items-center gap-1.5 text-text-subtle">{icon} {title}</div>
      {name && <div className="mt-1 font-medium text-text">{name}</div>}
      {sub && <div className="text-xs text-text-muted">{sub}</div>}
      <div className="mt-1.5 space-y-0.5 text-sm">
        {phone && (
          <a href={`tel:${phone}`} className="flex items-center gap-1.5 text-brand-700 hover:underline">
            <Phone className="h-3 w-3 text-text-muted" strokeWidth={2} /> {phone}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="flex items-center gap-1.5 break-all text-brand-700 hover:underline">
            <Mail className="h-3 w-3 text-text-muted" strokeWidth={2} /> {email}
          </a>
        )}
      </div>
    </div>
  );
}
