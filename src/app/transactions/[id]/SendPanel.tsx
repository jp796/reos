"use client";

/**
 * SendPanel — pick a template, preview merged content, edit, send via
 * the user's Gmail. Stays on the transaction detail so the TC can fire
 * an email without leaving context.
 *
 * Workflow:
 *   1. Pick a template from the dropdown → client auto-fetches the
 *      server-rendered preview (so it sees the exact merged output,
 *      including resolved/unresolved var counts).
 *   2. Auto-fill To based on template.defaultTo roles:
 *      primary_contact → txn.contact.primaryEmail
 *      title           → txn.titleCompanyName's first associated email (stub)
 *      co_buyer / co_seller / etc. → matching participant emails
 *      (primary_contact is the default for any unrecognized value).
 *   3. Show resolved vars in green, unresolved in red — Vicki sees at
 *      a glance what's missing before she sends.
 *   4. Edit subject/body freely. Send fires POST action:"send".
 *
 * Keeps outgoing mail under the user's own Gmail (not a no-reply),
 * so replies land in their inbox naturally.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Send } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Template {
  id: string;
  name: string;
  category: string | null;
  defaultTo: string[];
}

interface Preview {
  subject: string;
  body: string;
  resolved: string[];
  unresolved: string[];
}

interface Party {
  role: string;
  fullName: string;
  email: string | null;
}

export function SendPanel({
  transactionId,
  primaryEmail,
  parties,
}: {
  transactionId: string;
  /** Primary contact's email — usually the default recipient. */
  primaryEmail: string | null;
  /** All participant emails keyed by role for auto-populating To. */
  parties: Party[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const res = await fetch("/api/email-templates");
        const data = await res.json();
        if (!done) {
          setTemplates(data.items ?? []);
          setLoadingTpl(false);
        }
      } catch {
        if (!done) setLoadingTpl(false);
      }
    })();
    return () => {
      done = true;
    };
  }, []);

  async function pickTemplate(id: string) {
    setSelectedId(id);
    if (!id) {
      setPreview(null);
      setSubject("");
      setBody("");
      return;
    }
    const t = templates.find((x) => x.id === id);
    // Auto-fill To from defaultTo roles
    const tos = new Set<string>();
    for (const role of t?.defaultTo ?? []) {
      if (role === "primary_contact" && primaryEmail) tos.add(primaryEmail);
      for (const p of parties) {
        if (p.role === role && p.email) tos.add(p.email);
      }
    }
    if (tos.size === 0 && primaryEmail) tos.add(primaryEmail);
    setTo([...tos].join(", "));

    // Fetch preview
    try {
      const res = await fetch(`/api/transactions/${transactionId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: id, action: "preview" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setPreview({
        subject: data.subject,
        body: data.body,
        resolved: data.resolved ?? [],
        unresolved: data.unresolved ?? [],
      });
      setSubject(data.subject);
      setBody(data.body);
    } catch (e) {
      toast.error("Preview failed", e instanceof Error ? e.message : "unknown");
    }
  }

  async function send() {
    if (!selectedId || !to.trim() || !subject.trim() || !body.trim()) {
      toast.error("Missing required fields");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: selectedId,
          action: "send",
          to: to.split(",").map((s) => s.trim()).filter(Boolean),
          cc: cc.split(",").map((s) => s.trim()).filter(Boolean),
          subject,
          body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success("Sent", `Gmail ID: ${data.gmailMessageId?.slice(0, 10)}…`);
      // Reset
      setSelectedId("");
      setPreview(null);
      setTo("");
      setCc("");
      setSubject("");
      setBody("");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Send failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Mail className="h-4 w-4 text-text-muted" strokeWidth={1.8} />
          Send from template
        </h2>
      </div>

      {loadingTpl ? (
        <div className="text-xs text-text-muted">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface-2 p-4 text-sm text-text-muted">
          No templates yet.{" "}
          <a
            href="/settings/templates"
            className="text-brand-700 underline hover:text-brand-600"
          >
            Create one in settings
          </a>
          .
        </div>
      ) : (
        <div className="space-y-3">
          {/* Quick-send shortcuts — one click pre-selects a common
              template instead of hunting through the dropdown. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(() => {
              const quickPicks: Array<{ matchName: string; label: string }> = [
                { matchName: "request lending estimate", label: "📋 Request lending estimate" },
                { matchName: "welcome", label: "👋 Welcome (under contract)" },
                { matchName: "executed contract to title", label: "📄 Send contract to title" },
                { matchName: "clear to close", label: "🔑 Clear to close" },
                { matchName: "review request", label: "⭐ Post-close review" },
              ];
              return quickPicks.map((qp) => {
                const match = templates.find((t) =>
                  t.name.toLowerCase().includes(qp.matchName),
                );
                if (!match) return null;
                const active = selectedId === match.id;
                return (
                  <button
                    key={qp.matchName}
                    type="button"
                    onClick={() => pickTemplate(match.id)}
                    className={
                      "rounded border px-2 py-1 text-[11px] font-medium transition-colors " +
                      (active
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-border bg-surface text-text-muted hover:border-brand-500 hover:text-brand-700")
                    }
                  >
                    {qp.label}
                  </button>
                );
              });
            })()}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <select
              value={selectedId}
              onChange={(e) => pickTemplate(e.target.value)}
              className="rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">— pick a template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.category ? `(${t.category})` : ""}
                </option>
              ))}
            </select>
            <a
              href="/settings/templates"
              className="inline-flex items-center rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-text-muted hover:border-border-strong hover:text-text"
            >
              Manage
            </a>
          </div>

          {preview && (
            <>
              <label className="block">
                <span className="reos-label">To (comma-separated)</span>
                <input
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="reos-label">
                  Cc{" "}
                  <span className="font-normal text-text-subtle">(optional)</span>
                </span>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="reos-label">Subject</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="reos-label">Body</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-sm focus:border-brand-500 focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-text-muted">
                  {preview.resolved.length > 0 && (
                    <span className="mr-2 text-emerald-700">
                      ✓ {preview.resolved.length} resolved
                    </span>
                  )}
                  {preview.unresolved.length > 0 && (
                    <span
                      className="text-red-700"
                      title={preview.unresolved.join(", ")}
                    >
                      ⚠ {preview.unresolved.length} unresolved variable(s) — hover for list
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={send}
                  disabled={sending || pending}
                  className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={2} />
                  {sending ? "Sending…" : "Send via Gmail"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
