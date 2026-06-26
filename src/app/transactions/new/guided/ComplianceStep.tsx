"use client";

/**
 * ComplianceStep — Step 4 of the guided intake (compliance checklist).
 *
 * A flat, editable list of the documents needed to stay compliant
 * through closing. Atlas-suggested docs carry a ✨ Sparkles marker;
 * the rest are the standard set. Each item is a sub-card that can be
 * inline-edited (name + description, ✓ / ✗ in the FieldRow style),
 * removed, or added fresh via "+ Add document". A search box filters
 * the visible list by name. All state is local — no backend calls.
 *
 * Built against the real 1650 North Ridge Dr fixture (complianceModel.ts).
 */

import { useMemo, useState } from "react";
import { Pencil, Check, X, Plus, Trash2, Search, Sparkles } from "lucide-react";
import { type ComplianceItem } from "./complianceModel";

let nextId = 0;
/** Stable-enough id for items the user adds in this session. */
function newItemId(): string {
  nextId += 1;
  return `custom-${nextId}`;
}

export function ComplianceStep({ initial }: { initial: ComplianceItem[] }) {
  const [items, setItems] = useState<ComplianceItem[]>(initial);
  const [query, setQuery] = useState("");
  // The id of an item that was just added blank, so it opens in edit mode.
  const [autoEditId, setAutoEditId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, query]);

  function saveItem(id: string, name: string, description: string) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, name, description } : it)),
    );
    setAutoEditId((cur) => (cur === id ? null : cur));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setAutoEditId((cur) => (cur === id ? null : cur));
  }

  function addItem() {
    const id = newItemId();
    setItems((prev) => [
      ...prev,
      { id, name: "", description: "", aiSuggested: false },
    ]);
    setAutoEditId(id);
    // A new blank doc shouldn't be hidden by an active filter.
    setQuery("");
  }

  return (
    <div>
      <div>
        <h1 className="font-display text-2xl font-semibold">
          Confirm your compliance checklist
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          These are the documents needed to stay compliant through closing.
          Edit, remove, or add your own.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:min-w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents"
            aria-label="Search documents"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text placeholder:text-text-subtle focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500"
        >
          <Plus className="h-4 w-4" />
          Add document
        </button>
      </div>

      <section className="mt-5 rounded-xl border border-border bg-surface p-4">
        <h2 className="reos-label mb-3">
          Documents
          <span className="ml-2 font-normal text-text-subtle">
            {filtered.length} of {items.length}
          </span>
        </h2>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-2 p-6 text-center">
            <p className="text-sm font-medium text-text">No documents match</p>
            <p className="mt-1 text-xs text-text-muted">
              {items.length === 0
                ? "Add the documents this deal needs to stay compliant."
                : "Try a different search, or add a new document."}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((item) => (
              <DocumentRow
                key={item.id}
                item={item}
                startEditing={item.id === autoEditId}
                onSave={(name, description) =>
                  saveItem(item.id, name, description)
                }
                onRemove={() => removeItem(item.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DocumentRow({
  item,
  startEditing,
  onSave,
  onRemove,
}: {
  item: ComplianceItem;
  startEditing: boolean;
  onSave: (name: string, description: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [descDraft, setDescDraft] = useState(item.description);

  function beginEdit() {
    setNameDraft(item.name);
    setDescDraft(item.description);
    setEditing(true);
  }

  function commit() {
    const name = nameDraft.trim();
    const description = descDraft.trim();
    // An empty name is the one thing that breaks the list — keep editing
    // rather than silently saving a nameless card.
    if (!name) return;
    onSave(name, description);
    setEditing(false);
  }

  function cancel() {
    // A never-named item (just added blank) is discarded on cancel so the
    // list isn't left with an empty card.
    if (!item.name.trim()) {
      onRemove();
      return;
    }
    setNameDraft(item.name);
    setDescDraft(item.description);
    setEditing(false);
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      {editing ? (
        <div className="flex items-start gap-1.5">
          <div className="flex-1 space-y-2">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") cancel();
              }}
              placeholder="Document name"
              aria-label="Document name"
              className="w-full rounded-md border border-brand-400 bg-surface px-2 py-1.5 text-sm font-semibold text-text focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancel();
              }}
              rows={3}
              placeholder="What this document is and why it's needed"
              aria-label="Document description"
              className="w-full rounded-md border border-brand-400 bg-surface px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <button
            type="button"
            onClick={commit}
            aria-label="Save"
            className="mt-0.5 rounded-md bg-accent-600 p-1.5 text-white hover:bg-accent-500"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel"
            className="mt-0.5 rounded-md border border-border bg-surface p-1.5 text-text-muted hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-text">
                {item.name}
              </span>
              {item.aiSuggested ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-100 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900/40"
                  title="Suggested by Atlas from your contract"
                >
                  <Sparkles className="h-3 w-3" />
                  Suggested
                </span>
              ) : null}
            </div>
            {item.description ? (
              <p className="mt-1 text-sm text-text-muted">{item.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={beginEdit}
              aria-label={`Edit ${item.name}`}
              className="rounded-md p-1.5 text-text-subtle hover:bg-surface hover:text-text"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${item.name}`}
              className="rounded-md p-1.5 text-text-subtle hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
