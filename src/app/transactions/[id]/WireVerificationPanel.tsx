"use client";

/**
 * WireVerificationPanel — log that the TC verified wire instructions
 * with title/settlement by voice call before the client sent funds.
 *
 * Compliance record. Every logged entry immutable (no edit/delete in
 * the UI — if something's wrong, add a correcting entry). Primary
 * purpose: proof the brokerage followed its wire-fraud prevention
 * protocol if the wire is ever disputed.
 *
 * Guards in the panel UI:
 *   - Live-warns if the summary looks like it contains a full account
 *     number (>=8 digits in a row). Server rejects too.
 *   - Big red banner if NO verification has been logged yet and
 *     closing is within 7 days.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, AlertOctagon } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Verification {
  id: string;
  verifiedAt: string;
  titleAgentName: string | null;
  phoneCalled: string | null;
  instructionsSummary: string | null;
  notes: string | null;
  verifiedByUserId: string | null;
  createdAt: string;
}

export function WireVerificationPanel({
  transactionId,
  closingDate,
  titleCompanyName,
}: {
  transactionId: string;
  closingDate: string | null;
  titleCompanyName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Form state
  const nowIso = new Date().toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
  const [form, setForm] = useState({
    verifiedAt: nowIso,
    titleAgentName: "",
    phoneCalled: "",
    instructionsSummary: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const warnAccountNumber = /\b\d{8,}\b/.test(
    `${form.instructionsSummary} ${form.notes}`,
  );

  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/transactions/${transactionId}/wire-verifications`,
        );
        const data = await res.json();
        if (!done) {
          setItems(data.items ?? []);
          setLoading(false);
        }
      } catch {
        if (!done) setLoading(false);
      }
    })();
    return () => {
      done = true;
    };
  }, [transactionId]);

  const closing = closingDate ? new Date(closingDate) : null;
  const daysToClose = closing
    ? Math.ceil((closing.getTime() - Date.now()) / 86_400_000)
    : null;
  const unverifiedAndClosing =
    items.length === 0 && daysToClose !== null && daysToClose <= 7 && daysToClose >= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (warnAccountNumber) {
      toast.error(
        "Sensitive data detected",
        "Don't paste full account or routing numbers — summarize (last 4, etc.).",
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/wire-verifications`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            verifiedAt: new Date(form.verifiedAt).toISOString(),
            titleAgentName: form.titleAgentName,
            phoneCalled: form.phoneCalled,
            instructionsSummary: form.instructionsSummary,
            notes: form.notes,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setItems((cur) => [data.verification, ...cur]);
      setForm({
        verifiedAt: new Date().toISOString().slice(0, 16),
        titleAgentName: "",
        phoneCalled: "",
        instructionsSummary: "",
        notes: "",
      });
      setOpen(false);
      toast.success("Wire verification logged");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Log failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-emerald-600" strokeWidth={1.8} />
          Wire verification log
          <span className="font-normal text-text-muted">
            · {loading ? "…" : `${items.length} logged`}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium hover:border-brand-500 hover:text-brand-700"
        >
          {open ? "Cancel" : "+ Log verification call"}
        </button>
      </div>

      {unverifiedAndClosing && (
        <div className="mb-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/40 p-3 text-sm text-red-800">
          <AlertOctagon
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
            strokeWidth={2}
          />
          <div>
            <div className="font-medium">No wire verification logged.</div>
            <div className="mt-0.5 text-xs">
              Closing is in {daysToClose} day(s). Call {titleCompanyName ?? "the title co"}{" "}
              at a number you <b>know</b> (not from an email), confirm wire
              instructions verbally, and log the call here before your client
              sends funds.
            </div>
          </div>
        </div>
      )}

      {open && (
        <form
          onSubmit={submit}
          className="mb-3 space-y-2 rounded border border-border bg-surface-2 p-3"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="reos-label">Verified at</span>
              <input
                type="datetime-local"
                value={form.verifiedAt}
                onChange={(e) => setForm({ ...form, verifiedAt: e.target.value })}
                required
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="reos-label">Title agent name</span>
              <input
                type="text"
                value={form.titleAgentName}
                onChange={(e) => setForm({ ...form, titleAgentName: e.target.value })}
                placeholder="e.g. Amanda Rosentreter"
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="reos-label">Phone called</span>
              <input
                type="tel"
                value={form.phoneCalled}
                onChange={(e) => setForm({ ...form, phoneCalled: e.target.value })}
                placeholder="(307) 555-5555 — the number you KNOW, not from an email"
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="reos-label">
                Instructions summary{" "}
                <span className="font-normal text-text-subtle">
                  (last-4s and amounts — NO full account numbers)
                </span>
              </span>
              <input
                type="text"
                value={form.instructionsSummary}
                onChange={(e) =>
                  setForm({ ...form, instructionsSummary: e.target.value })
                }
                placeholder="Last 4 acct match 4823, amount $12,500, no changes since contract"
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="reos-label">Notes</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="e.g. 'Spoke with Amanda; she confirmed no changes to instructions since last week.'"
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          {warnAccountNumber && (
            <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              ⚠︎ Looks like you pasted an 8+ digit number. Summarize (last 4
              only) — full account / routing numbers must not live in REOS.
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || warnAccountNumber}
              className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
              {saving ? "Logging…" : "Log verification"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-xs text-text-muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface-2 p-3 text-xs text-text-muted">
          No verifications logged yet. The record is created the moment you
          click <b>Log verification call</b> after confirming instructions
          with title by phone.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((v) => (
            <li
              key={v.id}
              className="rounded border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/40 p-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text">
                    Verified {new Date(v.verifiedAt).toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {v.titleAgentName && <>with <b>{v.titleAgentName}</b>{" "}</>}
                    {v.phoneCalled && <>· {v.phoneCalled}</>}
                  </div>
                  {v.instructionsSummary && (
                    <div className="mt-1.5 text-xs text-text">
                      <span className="text-text-muted">Summary: </span>
                      {v.instructionsSummary}
                    </div>
                  )}
                  {v.notes && (
                    <div className="mt-1 text-xs italic text-text-muted">
                      {v.notes}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
