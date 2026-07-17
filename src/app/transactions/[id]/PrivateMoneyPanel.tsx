"use client";

/**
 * PrivateMoneyPanel — the private-money capital partners funding a deal.
 * Attach a partner from the account directory (with the amount they funded),
 * quick-add a new partner inline, or remove a funding. Partners are managed
 * once and reused across deals; the weekly partner-update email reads these.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Funding {
  id: string;
  amount: number | null;
  note: string | null;
  partner: { id: string; name: string; company: string | null };
}
interface Partner {
  id: string;
  name: string;
  company: string | null;
}

const money = (n: number | null) => (n == null ? "" : "$" + Math.round(n).toLocaleString());

export function PrivateMoneyPanel({
  transactionId,
  initialFundings,
}: {
  transactionId: string;
  initialFundings: Funding[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch("/api/private-money/partners")
      .then((r) => r.json())
      .then((d) => setPartners(d.partners ?? []))
      .catch(() => {});
  }, []);

  async function attach() {
    if (!partnerId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/funding`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partnerId, amount: amount ? Number(amount) : null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      setPartnerId("");
      setAmount("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't attach partner");
    } finally {
      setBusy(false);
    }
  }

  async function quickAdd() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/private-money/partners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "failed");
      setPartners((p) => [...p, { id: d.item.id, name: d.item.name, company: null }].sort((a, b) => a.name.localeCompare(b.name)));
      setPartnerId(d.item.id);
      setNewName("");
      setAdding(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add partner");
    } finally {
      setBusy(false);
    }
  }

  async function remove(fundingId: string) {
    setBusy(true);
    try {
      await fetch(`/api/transactions/${transactionId}/funding?fundingId=${fundingId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const total = initialFundings.reduce((s, f) => s + (f.amount ?? 0), 0);
  const available = partners.filter((p) => !initialFundings.some((f) => f.partner.id === p.id));

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Private money</h3>
        {total > 0 && <span className="text-xs text-text-muted">{money(total)} funded</span>}
      </div>

      {initialFundings.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {initialFundings.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2/50">
              <span>
                <span className="font-medium">{f.partner.name}</span>
                {f.partner.company && <span className="text-text-muted"> · {f.partner.company}</span>}
              </span>
              <span className="flex items-center gap-2">
                {f.amount != null && <span className="tabular-nums text-text-muted">{money(f.amount)}</span>}
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  disabled={busy}
                  className="text-text-subtle hover:text-red-600"
                  title="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-text-muted">No private-money partners on this deal yet.</p>
      )}

      {/* Attach an existing partner + amount */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
          className="reos-input max-w-[14rem] flex-1"
        >
          <option value="">Select partner…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.company ? ` · ${p.company}` : ""}
            </option>
          ))}
        </select>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="Amount"
          inputMode="decimal"
          className="reos-input w-28"
        />
        <button
          type="button"
          onClick={attach}
          disabled={busy || !partnerId}
          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {/* Quick-add a brand-new partner */}
      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New partner name"
            className="reos-input flex-1"
            autoFocus
          />
          <button type="button" onClick={quickAdd} disabled={busy || !newName.trim()} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:border-brand-300">
            Save
          </button>
          <button type="button" onClick={() => { setAdding(false); setNewName(""); }} className="text-xs text-text-subtle hover:text-text">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 text-xs font-medium text-brand-700 hover:underline"
        >
          + New partner
        </button>
      )}
      <p className="mt-2 text-[11px] text-text-subtle">
        Manage all partners in the <a href="/private-money" className="text-brand-700 hover:underline">Private money directory</a>.
      </p>
    </section>
  );
}
