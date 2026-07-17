"use client";

/** Client directory for private-money partners — add / edit / delete, and see
 *  which deals each partner funds. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Pencil, Mail } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Deal {
  transactionId: string;
  property: string;
  status: string;
  amount: number | null;
}
interface Row {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  typicalAmount: number | null;
  notes: string | null;
  deals: Deal[];
}
type Draft = Partial<Pick<Row, "name" | "company" | "email" | "phone" | "typicalAmount" | "notes">>;

const money = (n: number | null) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());

export function PrivateMoneyDirectory({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  // Weekly partner-update email (draft → review → send on click).
  const [emailFor, setEmailFor] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string }>({ subject: "", body: "" });
  const [emailBusy, setEmailBusy] = useState(false);

  async function openEmail(r: Row) {
    if (emailFor === r.id) { setEmailFor(null); return; }
    setEmailBusy(true);
    try {
      const res = await fetch(`/api/private-money/partners/${r.id}/update-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "failed");
      setEmailDraft(d.draft);
      setEmailFor(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the draft");
    } finally {
      setEmailBusy(false);
    }
  }

  async function sendEmail(r: Row) {
    if (!r.email) { toast.error("Add an email for this partner first"); return; }
    setEmailBusy(true);
    try {
      const res = await fetch(`/api/private-money/partners/${r.id}/update-email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ send: true, subject: emailDraft.subject, body: emailDraft.body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "failed");
      toast.success(`Update sent to ${r.name}`);
      setEmailFor(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setEmailBusy(false);
    }
  }

  function startCreate() {
    setDraft({});
    setCreating(true);
    setEditing(null);
  }
  function startEdit(r: Row) {
    setDraft({ name: r.name, company: r.company, email: r.email, phone: r.phone, typicalAmount: r.typicalAmount, notes: r.notes });
    setEditing(r.id);
    setCreating(false);
  }

  async function save(id?: string) {
    if (!draft.name?.trim()) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    try {
      const url = id ? `/api/private-money/partners/${id}` : "/api/private-money/partners";
      const res = await fetch(url, {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          company: draft.company ?? null,
          email: draft.email ?? null,
          phone: draft.phone ?? null,
          typicalAmount: draft.typicalAmount != null && !Number.isNaN(Number(draft.typicalAmount)) ? Number(draft.typicalAmount) : null,
          notes: draft.notes ?? null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      setEditing(null);
      setCreating(false);
      setDraft({});
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string, name: string) {
    if (!confirm(`Remove ${name} from your private-money directory? This also removes them from any deals.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/private-money/partners/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const Form = ({ id }: { id?: string }) => (
    <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:bg-brand-950/20">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input className="reos-input" placeholder="Name *" value={draft.name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        <input className="reos-input" placeholder="Company" value={draft.company ?? ""} onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))} />
        <input className="reos-input" placeholder="Email" value={draft.email ?? ""} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
        <input className="reos-input" placeholder="Phone" value={draft.phone ?? ""} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
        <input className="reos-input" placeholder="Typical amount" inputMode="decimal" value={draft.typicalAmount ?? ""} onChange={(e) => setDraft((d) => ({ ...d, typicalAmount: e.target.value.replace(/[^0-9.]/g, "") as unknown as number }))} />
      </div>
      <textarea className="reos-input" placeholder="Notes" rows={2} value={draft.notes ?? ""} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
      <div className="flex gap-2">
        <button type="button" onClick={() => save(id)} disabled={busy} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">Save</button>
        <button type="button" onClick={() => { setEditing(null); setCreating(false); }} className="text-sm text-text-muted hover:text-text">Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {creating ? <Form /> : (
        <button type="button" onClick={startCreate} className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500">
          <Plus className="h-4 w-4" /> Add partner
        </button>
      )}

      {initial.length === 0 && !creating && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">
          No partners yet. Add your first capital partner.
        </p>
      )}

      <ul className="space-y-2">
        {initial.map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-surface p-3">
            {editing === r.id ? (
              <Form id={r.id} />
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {r.name}
                      {r.company && <span className="text-text-muted"> · {r.company}</span>}
                    </div>
                    <div className="text-xs text-text-muted">
                      {[r.email, r.phone].filter(Boolean).join(" · ") || "no contact info"}
                      {r.typicalAmount != null && <span> · typical {money(r.typicalAmount)}</span>}
                    </div>
                    {r.notes && <div className="mt-1 text-xs text-text-subtle">{r.notes}</div>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => openEmail(r)} disabled={emailBusy} className="rounded p-1 text-text-subtle hover:text-brand-700" title="Draft weekly update"><Mail className="h-4 w-4" /></button>
                    <button type="button" onClick={() => startEdit(r)} className="rounded p-1 text-text-subtle hover:text-brand-700" title="Edit"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => del(r.id, r.name)} className="rounded p-1 text-text-subtle hover:text-red-600" title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>

                {emailFor === r.id && (
                  <div className="mt-3 space-y-2 rounded-md border border-brand-200 bg-brand-50/40 p-3 dark:bg-brand-950/20">
                    <div className="reos-label text-text-subtle">
                      Weekly update {r.email ? `to ${r.email}` : "— add an email to send"}
                    </div>
                    <input
                      className="reos-input"
                      value={emailDraft.subject}
                      onChange={(e) => setEmailDraft((d) => ({ ...d, subject: e.target.value }))}
                    />
                    <textarea
                      className="reos-input font-mono text-xs"
                      rows={8}
                      value={emailDraft.body}
                      onChange={(e) => setEmailDraft((d) => ({ ...d, body: e.target.value }))}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => sendEmail(r)}
                        disabled={emailBusy || !r.email}
                        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                      >
                        Send to {r.name.split(" ")[0]}
                      </button>
                      <button type="button" onClick={() => setEmailFor(null)} className="text-sm text-text-muted hover:text-text">Cancel</button>
                      <span className="text-[11px] text-text-subtle">Review before sending — nothing goes out on its own.</span>
                    </div>
                  </div>
                )}
                {r.deals.length > 0 && (
                  <div className="mt-2 border-t border-border pt-2 text-xs">
                    <span className="text-text-subtle">Funding {r.deals.length} deal{r.deals.length === 1 ? "" : "s"}: </span>
                    {r.deals.map((d, i) => (
                      <span key={d.transactionId}>
                        {i > 0 && ", "}
                        <Link href={`/transactions/${d.transactionId}`} className="text-brand-700 hover:underline">
                          {d.property}
                        </Link>
                        {d.amount != null && <span className="text-text-muted"> ({money(d.amount)})</span>}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
