"use client";

/**
 * TimelineStep — Step 3 of the guided intake (Review your timeline).
 *
 * The computed deadline list as editable cards: each shows the date +
 * relative derivation, a milestone flag toggle (green when on, like
 * Closing), inline edit (name + date) and delete, plus "+ Add deadline".
 * Same card / inline-edit language as ReviewDetailsStep. Local state.
 */

import { useState } from "react";
import {
  CalendarDays,
  Flag,
  Pencil,
  Trash2,
  Check,
  X,
  Plus,
} from "lucide-react";
import { type TimelineItem, fmtTimelineDate } from "./timelineModel";

export function TimelineStep({ initial }: { initial: TimelineItem[] }) {
  const [items, setItems] = useState<TimelineItem[]>(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; date: string }>({
    name: "",
    date: "",
  });

  function startEdit(it: TimelineItem) {
    setDraft({ name: it.name, date: it.date });
    setEditing(it.id);
  }
  function commit(id: string) {
    setItems((xs) =>
      xs.map((x) =>
        x.id === id ? { ...x, name: draft.name.trim() || x.name, date: draft.date } : x,
      ),
    );
    setEditing(null);
  }
  function toggleFlag(id: string) {
    setItems((xs) =>
      xs.map((x) => (x.id === id ? { ...x, milestone: !x.milestone } : x)),
    );
  }
  function remove(id: string) {
    setItems((xs) => xs.filter((x) => x.id !== id));
    if (editing === id) setEditing(null);
  }
  function addDeadline() {
    const id = `new-${items.length}-${editing ?? ""}${Math.max(
      0,
      items.length,
    )}`;
    const item: TimelineItem = { id, name: "New deadline", date: "" };
    setItems((xs) => [...xs, item]);
    startEdit(item);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            Review your timeline
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Atlas computed these from your Effective Date. Adjust anything
            that&rsquo;s off, flag your key milestones, or add a deadline.
          </p>
        </div>
        <button
          type="button"
          onClick={addDeadline}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:border-brand-400 dark:border-brand-900/40 dark:bg-brand-950/30 dark:text-brand-200"
        >
          <Plus className="h-4 w-4" /> Add deadline
        </button>
      </div>

      <div className="mt-5 space-y-2.5">
        {items.map((it) => (
          <div
            key={it.id}
            className="rounded-xl border border-border bg-surface p-3.5"
          >
            {editing === it.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Deadline name"
                  className="min-w-[200px] flex-1 rounded-md border border-brand-400 bg-surface px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  className="rounded-md border border-brand-400 bg-surface px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
                <button
                  type="button"
                  onClick={() => commit(it.id)}
                  aria-label="Save"
                  className="rounded-md bg-accent-600 p-1.5 text-white hover:bg-accent-500"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  aria-label="Cancel"
                  className="rounded-md border border-border bg-surface p-1.5 text-text-muted hover:text-text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    it.milestone
                      ? "bg-accent-50 text-accent-600 ring-1 ring-accent-200"
                      : "bg-surface-2 text-text-muted"
                  }`}
                >
                  <CalendarDays className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text">{it.name}</div>
                  <div className="text-sm text-text-muted">
                    {fmtTimelineDate(it.date)}
                    {it.relativeNote ? (
                      <span className="italic text-text-subtle">
                        {" "}
                        — {it.relativeNote}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => toggleFlag(it.id)}
                    aria-label={it.milestone ? "Unflag milestone" : "Flag as key milestone"}
                    title="Flag key milestone"
                    className={`rounded-md p-1.5 hover:bg-surface-2 ${
                      it.milestone ? "text-accent-600" : "text-text-subtle"
                    }`}
                  >
                    <Flag className="h-4 w-4" fill={it.milestone ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(it)}
                    aria-label="Edit"
                    className="rounded-md p-1.5 text-text-subtle hover:bg-surface-2 hover:text-text"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(it.id)}
                    aria-label="Delete"
                    className="rounded-md p-1.5 text-text-subtle hover:bg-surface-2 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
