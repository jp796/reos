"use client";

/**
 * TemplatesManager — two-pane view (list left, editor right) for
 * email templates. Clicking a row opens it in the editor; changes
 * save via PATCH on a save button (no auto-save to avoid mid-edit
 * state surprises).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, Trash2, Save } from "lucide-react";
import { useToast } from "@/app/ToastProvider";
import { cn } from "@/lib/cn";

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string | null;
  defaultTo: string[];
  isStarter: boolean;
  sortOrder: number;
}

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "inspection", label: "Inspection" },
  { id: "title", label: "Title" },
  { id: "clear_to_close", label: "Clear to close" },
  { id: "closing", label: "Closing" },
  { id: "post_close", label: "Post close" },
  { id: "review_request", label: "Review request" },
  { id: "generic", label: "Generic" },
];

const VARIABLE_HELP = [
  { group: "Property", vars: ["property_address", "property_city", "property_state", "property_full"] },
  { group: "Dates", vars: ["effective_date", "closing_date", "inspection_deadline", "inspection_objection_deadline", "title_commitment_deadline", "financing_deadline", "walkthrough_date", "today"] },
  { group: "People", vars: ["client_first_name", "client_name", "client_email", "buyer_name", "seller_name", "agent_name", "brokerage_name", "title_company", "lender_name"] },
  { group: "Money", vars: ["sale_price", "gross_commission", "commission_percent"] },
];

export function TemplatesManager({
  initial,
  canSeed,
}: {
  initial: Template[];
  canSeed: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Template[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const active = items.find((t) => t.id === activeId) ?? null;

  // Edit buffer (so cancel is real)
  const [edit, setEdit] = useState<Template | null>(active);

  // When clicking a different template, sync edit
  function openTemplate(id: string) {
    const t = items.find((x) => x.id === id);
    setActiveId(id);
    setEdit(t ?? null);
  }

  async function save() {
    if (!edit) return;
    try {
      const res = await fetch(`/api/email-templates/${edit.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: edit.name,
          subject: edit.subject,
          body: edit.body,
          category: edit.category ?? "generic",
          defaultTo: edit.defaultTo,
          sortOrder: edit.sortOrder,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setItems((cur) => cur.map((t) => (t.id === edit.id ? data.template : t)));
      toast.success("Template saved");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "unknown");
    }
  }

  async function removeTemplate(id: string) {
    if (!window.confirm("Delete this template?")) return;
    try {
      const res = await fetch(`/api/email-templates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(res.statusText);
      setItems((cur) => cur.filter((t) => t.id !== id));
      if (activeId === id) {
        const next = items.find((t) => t.id !== id);
        setActiveId(next?.id ?? null);
        setEdit(next ?? null);
      }
      toast.success("Template deleted");
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : "unknown");
    }
  }

  async function createBlank() {
    try {
      const res = await fetch("/api/email-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Untitled template",
          subject: "Subject",
          body: "Hi {{client_first_name}},\n\n",
          category: "generic",
          defaultTo: ["primary_contact"],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setItems((cur) => [...cur, data.template]);
      setActiveId(data.template.id);
      setEdit(data.template);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Create failed", e instanceof Error ? e.message : "unknown");
    }
  }

  async function seedStarters() {
    try {
      const res = await fetch("/api/email-templates?seed=1", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success(
        "Starters seeded",
        `${data.created} new template(s), ${data.skipped} already existed`,
      );
      // refetch
      const listRes = await fetch("/api/email-templates");
      const listData = await listRes.json();
      setItems(listData.items ?? []);
      if (listData.items?.[0] && !activeId) {
        setActiveId(listData.items[0].id);
        setEdit(listData.items[0]);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Seed failed", e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      {/* LEFT: list */}
      <aside className="rounded-lg border border-border bg-surface p-2">
        <div className="mb-2 flex items-center justify-between gap-1.5 px-1">
          <div className="reos-label">Templates ({items.length})</div>
          <div className="flex items-center gap-1">
            {canSeed && items.length === 0 && (
              <button
                type="button"
                onClick={seedStarters}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:border-brand-500 disabled:opacity-50"
                title="Seed the 5 starter templates"
              >
                <Sparkles className="h-3 w-3" strokeWidth={2} />
                Seed
              </button>
            )}
            <button
              type="button"
              onClick={createBlank}
              className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-0.5 text-[11px] font-medium hover:border-brand-500 hover:text-brand-700"
            >
              <Plus className="h-3 w-3" strokeWidth={2} />
              New
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="rounded border border-dashed border-border p-4 text-xs text-text-muted">
            No templates yet. {canSeed && "Click Seed to add the 5 starter templates, or New for a blank."}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => openTemplate(t.id)}
                  className={cn(
                    "flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                    activeId === t.id
                      ? "bg-brand-50 text-brand-800"
                      : "hover:bg-surface-2",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block truncate text-[10px] text-text-muted">
                      {t.category ?? "—"}
                      {t.isStarter && " · starter"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* RIGHT: editor */}
      <div className="rounded-lg border border-border bg-surface p-4">
        {!edit ? (
          <div className="rounded border border-dashed border-border bg-surface-2 p-8 text-center text-sm text-text-muted">
            Pick a template on the left, or click <b>+ New</b> to create one.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <input
                type="text"
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                className="flex-1 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm font-medium focus:border-brand-500 focus:outline-none"
                placeholder="Internal name"
              />
              <select
                value={edit.category ?? "generic"}
                onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-xs"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={save}
                className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500"
              >
                <Save className="h-3 w-3" strokeWidth={2} />
                Save
              </button>
              <button
                type="button"
                onClick={() => removeTemplate(edit.id)}
                className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-subtle hover:border-red-300 hover:text-red-600"
                title="Delete template"
              >
                <Trash2 className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>

            <label className="block">
              <span className="reos-label">Subject</span>
              <input
                type="text"
                value={edit.subject}
                onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="reos-label">Body</span>
              <textarea
                value={edit.body}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                rows={16}
                className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-sm focus:border-brand-500 focus:outline-none"
              />
            </label>

            <details className="rounded border border-border bg-surface-2 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-text">
                Available variables
              </summary>
              <div className="mt-2 space-y-2">
                {VARIABLE_HELP.map((g) => (
                  <div key={g.group}>
                    <div className="text-[10px] uppercase tracking-wide text-text-subtle">
                      {g.group}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {g.vars.map((v) => (
                        <code
                          key={v}
                          className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-muted"
                        >{`{{${v}}}`}</code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
