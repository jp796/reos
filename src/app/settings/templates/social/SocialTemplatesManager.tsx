"use client";

/**
 * SocialTemplatesManager
 *
 * 3 events × 3 platforms grid. Each cell is a textarea — saved as a
 * SocialPostTemplate row when non-empty, deleted (back to AI mode)
 * when emptied. Single Save button writes the entire matrix in one
 * transaction.
 *
 * Variable palette on the right: click any token to copy. Anchored
 * to the active textarea so the user can build the template by
 * clicking — keeps the syntax exact, no typos.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/ToastProvider";
import { TEMPLATE_VARIABLE_REFERENCE } from "@/services/ai/SocialTemplateRenderer";

type Event = "new_listing" | "under_contract" | "sold";
type Platform = "instagram" | "facebook" | "linkedin";

interface Template {
  event: string;
  platform: string;
  body: string;
  updatedAt: string;
}

const EVENT_LABEL: Record<Event, string> = {
  new_listing: "Just Listed",
  under_contract: "Under Contract",
  sold: "Just Sold",
};

const PLATFORMS: Array<{ id: Platform; label: string; hint: string }> = [
  { id: "instagram", label: "Instagram", hint: "Short, 3-5 lines, emojis OK" },
  { id: "facebook", label: "Facebook", hint: "Warmer, longer, personal voice" },
  { id: "linkedin", label: "LinkedIn", hint: "Professional, market angle" },
];

const EVENTS: Event[] = ["new_listing", "under_contract", "sold"];

// Cell key uniquely identifying one slot in the 3×3 matrix.
function cellKey(event: Event, platform: Platform): string {
  return `${event}|${platform}`;
}

export function SocialTemplatesManager({ initial }: { initial: Template[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  // Seed cell state from server data.
  const initialMatrix = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const t of initial) m[`${t.event}|${t.platform}`] = t.body;
    return m;
  }, [initial]);

  const [matrix, setMatrix] = useState<Record<string, string>>(initialMatrix);
  // Track which textarea is focused so the variable palette inserts
  // into the right one.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(initialMatrix), ...Object.keys(matrix)]);
    for (const k of keys) {
      if ((initialMatrix[k] ?? "") !== (matrix[k] ?? "")) return true;
    }
    return false;
  }, [matrix, initialMatrix]);

  function setCell(key: string, value: string) {
    setMatrix((m) => ({ ...m, [key]: value }));
  }

  /** Insert {{variable}} at the cursor of the focused textarea. */
  function insertVariable(key: string) {
    const target = focusedKey;
    if (!target) {
      toast.info(
        "Click a template field first",
        "Then click a variable to insert it at the cursor.",
      );
      return;
    }
    const el = document.getElementById(`tmpl-${target}`) as HTMLTextAreaElement | null;
    const token = `{{${key}}}`;
    if (!el) {
      setCell(target, (matrix[target] ?? "") + token);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setCell(target, next);
    // Restore focus + caret position just after the inserted token.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function save() {
    const payload = {
      templates: EVENTS.flatMap((ev) =>
        PLATFORMS.map((p) => ({
          event: ev,
          platform: p.id,
          body: matrix[cellKey(ev, p.id)] ?? "",
        })),
      ),
    };
    startTransition(async () => {
      try {
        const res = await fetch("/api/settings/social-templates", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        toast.success("Templates saved");
        router.refresh();
      } catch (e) {
        toast.error(
          "Save failed",
          e instanceof Error ? e.message : "unknown",
        );
      }
    });
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
      {/* ── Matrix (left, dominant) ─────────────────────────── */}
      <div className="space-y-6">
        {EVENTS.map((ev) => (
          <section
            key={ev}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-base font-semibold">
                {EVENT_LABEL[ev]}
              </h2>
              <span className="text-xs text-text-muted">
                Fires when status moves to {EVENT_LABEL[ev].toLowerCase()}
              </span>
            </header>
            <div className="grid gap-4 sm:grid-cols-3">
              {PLATFORMS.map((p) => {
                const key = cellKey(ev, p.id);
                const value = matrix[key] ?? "";
                const filled = value.trim().length > 0;
                return (
                  <label key={p.id} className="block">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-text">
                        {p.label}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide ${
                          filled ? "text-emerald-700" : "text-text-muted"
                        }`}
                      >
                        {filled ? "Custom" : "AI default"}
                      </span>
                    </div>
                    <textarea
                      id={`tmpl-${key}`}
                      value={value}
                      onChange={(e) => setCell(key, e.target.value)}
                      onFocus={() => setFocusedKey(key)}
                      placeholder={p.hint}
                      rows={6}
                      className="w-full rounded border border-border bg-surface-2 px-2.5 py-2 text-sm leading-relaxed focus:border-brand-500 focus:outline-none"
                    />
                  </label>
                );
              })}
            </div>
          </section>
        ))}
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">
            {dirty ? (
              <span className="text-amber-700">Unsaved changes.</span>
            ) : (
              "All saved."
            )}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save all"}
          </button>
        </div>
      </div>

      {/* ── Variable palette (right) ────────────────────────── */}
      <aside className="space-y-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="reos-label mb-2">Variables</h3>
          <p className="mb-3 text-xs text-text-muted">
            Click any tag to insert into the field you&rsquo;re editing.
          </p>
          <ul className="space-y-1.5 text-xs">
            {TEMPLATE_VARIABLE_REFERENCE.map((v) => (
              <li key={v.key}>
                <button
                  type="button"
                  onClick={() => insertVariable(v.key)}
                  className="group flex w-full items-baseline justify-between gap-2 rounded border border-transparent px-1.5 py-1 text-left hover:border-border hover:bg-surface-2"
                >
                  <code className="font-mono text-[11px] text-brand-700 group-hover:text-brand-600">
                    {`{{${v.key}}}`}
                  </code>
                  <span className="text-[10px] text-text-muted">{v.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-xs leading-relaxed text-text-muted">
          <p>
            <span className="font-medium text-text">Tip:</span> leave a slot
            empty and the AI writes that one. Fill it in to lock the
            language. Mix and match per platform.
          </p>
        </div>
      </aside>
    </div>
  );
}
