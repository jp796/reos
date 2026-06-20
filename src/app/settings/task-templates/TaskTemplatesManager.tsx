"use client";

/**
 * TaskTemplatesManager — create reusable task checklists (manually or
 * "Generate with Atlas"), then apply them to deals from the Tasks tab.
 */

import { useEffect, useState } from "react";
import { Sparkles, Loader2, Trash2, Check } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Item {
  title: string;
  description?: string | null;
  assignedTo: string;
  priority: string;
  relatesToMilestone?: string | null;
  offsetFromMilestoneDays?: number | null;
}
interface Template {
  id: string;
  name: string;
  description: string | null;
  source: string;
  itemCount: number;
  updatedAt: string;
}

export function TaskTemplatesManager() {
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // AI generation draft
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<{ name: string; items: Item[] } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/task-templates");
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function generate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setDraft(null);
    try {
      const res = await fetch("/api/task-templates/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "generation failed");
      setDraft({ name: data.name, items: data.items });
    } catch (e) {
      toast.error("Couldn't generate", e instanceof Error ? e.message : "unknown");
    } finally {
      setGenerating(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/task-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          source: "ai",
          items: draft.items,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      toast.success("Template saved", `${draft.items.length} tasks`);
      setDraft(null);
      setPrompt("");
      load();
    } catch (e) {
      toast.error("Couldn't save", e instanceof Error ? e.message : "unknown");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/task-templates/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-8">
      {/* Generate with Atlas */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-brand-600" /> Generate with Atlas
        </div>
        <p className="mb-3 text-xs text-text-muted">
          Describe the deal type and Atlas drafts a task checklist with smart due
          dates (tied to milestones). Review, then save.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
            placeholder="e.g. buyer-side conventional purchase in Texas with HOA"
            className="flex-1 rounded border border-border bg-surface-2 px-3 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
          />
          <button
            onClick={generate}
            disabled={generating || !prompt.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate
          </button>
        </div>

        {draft && (
          <div className="mt-4 rounded-md border border-brand-200 bg-brand-50/50 p-3">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="mb-2 w-full rounded border border-border bg-surface px-2 py-1 text-sm font-medium text-text"
            />
            <ul className="mb-3 max-h-64 space-y-1 overflow-y-auto text-sm">
              {draft.items.map((it, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-text">
                  <span>{i + 1}. {it.title}</span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {it.assignedTo}
                    {it.relatesToMilestone
                      ? ` · ${(it.offsetFromMilestoneDays ?? 0) >= 0 ? `${it.offsetFromMilestoneDays ?? 0}d before` : `${-(it.offsetFromMilestoneDays ?? 0)}d after`} ${it.relatesToMilestone.replace(/_/g, " ")}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={saveDraft}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Save template
              </button>
              <button
                onClick={() => setDraft(null)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-muted hover:text-text"
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Existing templates */}
      <section>
        <h2 className="mb-2 text-sm font-medium">Your task templates</h2>
        {loading ? (
          <div className="text-sm text-text-muted">
            <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-2/40 p-6 text-center text-sm text-text-muted">
            No templates yet. Generate one above — then apply it to any deal from
            its Tasks tab.
          </div>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">{t.name}</span>
                    {t.source === "ai" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                        <Sparkles className="h-2.5 w-2.5" /> AI
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted">{t.itemCount} tasks</div>
                </div>
                <button
                  onClick={() => remove(t.id)}
                  aria-label="Delete"
                  className="rounded p-1.5 text-text-muted hover:bg-surface-2 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
