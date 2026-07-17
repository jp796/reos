"use client";

/** Owner tool: draft + send the weekly "get more out of REOS" feature email to
 *  the team. Draft is generated server-side (rotating tips), editable, and only
 *  goes out when the owner clicks Send. */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

export function TeamFeatureEmailCard() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: "", body: "" });
  const [recipientCount, setRecipientCount] = useState(0);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch("/api/team-digest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "failed");
      setDraft(d.draft);
      setRecipientCount(d.recipientCount ?? 0);
      setOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the draft");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/team-digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ send: true, subject: draft.subject, body: draft.body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "failed");
      toast.success(`Sent to ${d.recipientCount} teammate${d.recipientCount === 1 ? "" : "s"}`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-brand-500" /> Team feature spotlight
          </h3>
          <p className="text-xs text-text-muted">A weekly email showing your team how to get more out of REOS.</p>
        </div>
        {!open && (
          <button type="button" onClick={generate} disabled={busy} className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-brand-300 hover:text-brand-700 disabled:opacity-50">
            Draft this week&rsquo;s
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <input className="reos-input" value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
          <textarea className="reos-input font-mono text-xs" rows={12} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
          <div className="flex items-center gap-2">
            <button type="button" onClick={send} disabled={busy || recipientCount === 0} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">
              Send to {recipientCount} teammate{recipientCount === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-text-muted hover:text-text">Cancel</button>
            <span className="text-[11px] text-text-subtle">Review before sending — nothing goes out on its own.</span>
          </div>
        </div>
      )}
    </section>
  );
}
