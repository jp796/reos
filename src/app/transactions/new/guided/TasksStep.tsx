"use client";

/**
 * TasksStep — Step 5 of the guided intake (Tasks review + Edit Task modal).
 *
 * Atlas drafts a set of tasks from the executed contract. This step lets the
 * user review them, search/filter by title, add a new blank task, toggle each
 * task done (strike-through), and edit any task in a centered modal before
 * finishing the intake.
 *
 * All state is local (useState) — no backend calls. The wizard reads the
 * task list out of this component when it integrates this step; until then
 * the FIXTURE_TASKS carry the real 1650 North Ridge Dr data.
 */

import { useMemo, useState } from "react";
import {
  Search,
  Plus,
  Mail,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import type { GuidedTask } from "./taskModel";

/** Direction of a relative-date offset. */
type RelativeDirection = "before" | "after";
/** What a relative-date offset is measured against. */
type RelativeAnchor = "deadline" | "task" | "document";

/** A blank task seed — used by "+ New" and as the modal's empty baseline. */
function blankTask(): GuidedTask {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    description: "",
    dueDate: "",
    autoEmail: false,
  };
}

export function TasksStep({ initial }: { initial: GuidedTask[] }) {
  const [tasks, setTasks] = useState<GuidedTask[]>(initial);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [tasks, query]);

  const editingTask = useMemo(
    () => tasks.find((t) => t.id === editingId) ?? null,
    [tasks, editingId],
  );

  function toggleDone(id: string) {
    setDone((d) => ({ ...d, [id]: !d[id] }));
  }

  function addTask() {
    const t = blankTask();
    setTasks((prev) => [...prev, t]);
    setEditingId(t.id);
  }

  function removeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setDone((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    if (editingId === id) setEditingId(null);
  }

  function saveTask(updated: GuidedTask) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setEditingId(null);
  }

  return (
    <div>
      <div>
        <h1 className="font-display text-2xl font-semibold">Review your tasks</h1>
        <p className="mt-1 text-sm text-text-muted">
          Atlas drafted these from your contract. Tasks with an envelope
          auto-draft the email when due. Edit anything before you finish.
        </p>
      </div>

      {/* Toolbar — search + new */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks by title"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <button
          type="button"
          onClick={addTask}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>

      {/* Task list */}
      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="reos-label mb-3">
          Tasks ({filtered.length}
          {filtered.length !== tasks.length ? ` of ${tasks.length}` : ""})
        </h2>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">
            {tasks.length === 0
              ? "No tasks yet. Add one to get started."
              : "No tasks match your search."}
          </p>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((task) => {
              const isDone = !!done[task.id];
              return (
                <div
                  key={task.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3"
                >
                  <button
                    type="button"
                    onClick={() => toggleDone(task.id)}
                    aria-pressed={isDone}
                    aria-label={isDone ? "Mark task not done" : "Mark task done"}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isDone
                        ? "border-accent-600 bg-accent-600 text-white"
                        : "border-border bg-surface hover:border-brand-400"
                    }`}
                  >
                    {isDone ? <Check className="h-3 w-3" /> : null}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-sm font-semibold ${
                          isDone
                            ? "text-text-subtle line-through"
                            : "text-text"
                        }`}
                      >
                        {task.title || "Untitled task"}
                      </span>
                      {task.autoEmail ? (
                        <span
                          className="inline-flex items-center"
                          title="Auto-drafts an email when due"
                          aria-label="Auto-drafts an email when due"
                        >
                          <Mail className="h-3.5 w-3.5 text-brand-600" />
                        </span>
                      ) : null}
                    </div>
                    {task.relatedCompliance ? (
                      <span className="mt-1 inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-100 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900/40">
                        {task.relatedCompliance}
                      </span>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-sm text-text">
                      {formatDueDate(task.dueDate)}
                    </div>
                    {task.relativeNote ? (
                      <div className="text-[11px] italic text-text-subtle">
                        {task.relativeNote}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(task.id)}
                      aria-label="Edit task"
                      className="rounded-md p-1.5 text-text-muted hover:bg-surface hover:text-text"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTask(task.id)}
                      aria-label="Remove task"
                      className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editingTask ? (
        <EditTaskModal
          task={editingTask}
          onSave={saveTask}
          onCancel={() => setEditingId(null)}
        />
      ) : null}
    </div>
  );
}

/** Format an ISO date (YYYY-MM-DD) as "Jun 16, 2026"; empty → "No date". */
function formatDueDate(iso: string): string {
  if (!iso) return "No date";
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  if (!y || !m || !d) return iso;
  // Construct as UTC to avoid timezone shifting the day.
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function EditTaskModal({
  task,
  onSave,
  onCancel,
}: {
  task: GuidedTask;
  onSave: (t: GuidedTask) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [autoEmail, setAutoEmail] = useState(task.autoEmail);
  const [emailTemplate, setEmailTemplate] = useState("");
  const [relativeDays, setRelativeDays] = useState("");
  const [relativeDirection, setRelativeDirection] =
    useState<RelativeDirection>("after");
  const [relativeAnchor, setRelativeAnchor] =
    useState<RelativeAnchor>("deadline");
  const [relativeItem, setRelativeItem] = useState(task.relatedCompliance ?? "");
  const [instruction, setInstruction] = useState(
    task.instruction ?? task.description,
  );
  const [notes, setNotes] = useState("");
  const [relatedCompliance, setRelatedCompliance] = useState(
    task.relatedCompliance ?? "",
  );

  function handleSave() {
    const days = relativeDays.trim();
    const item = relativeItem.trim();
    const relativeNote =
      days && item
        ? `${days} day${days === "1" ? "" : "s"} ${relativeDirection} ${item}`
        : task.relativeNote;

    onSave({
      ...task,
      title: title.trim(),
      dueDate,
      autoEmail,
      instruction: instruction.trim() || undefined,
      description: instruction.trim() || task.description,
      relatedCompliance: relatedCompliance.trim() || undefined,
      relativeNote,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit task"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />

      {/* Card */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text">Edit task</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {/* Title */}
          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </Field>

          {/* Due date */}
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </Field>

          {/* Auto-draft email toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 p-3">
            <div>
              <div className="text-sm font-medium text-text">
                Auto-draft email
              </div>
              <div className="text-xs text-text-muted">
                Atlas drafts an email when this task comes due.
              </div>
            </div>
            <Switch
              checked={autoEmail}
              onChange={setAutoEmail}
              label="Auto-draft email"
            />
          </div>

          {/* Email template (only relevant when auto-email on, but shown for clarity) */}
          <Field label="Email template">
            <input
              type="text"
              value={emailTemplate}
              onChange={(e) => setEmailTemplate(e.target.value)}
              placeholder="Leave empty for AI-powered selection"
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </Field>

          {/* Relative date */}
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="reos-label mb-2">Relative date</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Days">
                <input
                  type="number"
                  min={0}
                  value={relativeDays}
                  onChange={(e) => setRelativeDays(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
              <Field label="Direction">
                <select
                  value={relativeDirection}
                  onChange={(e) =>
                    setRelativeDirection(e.target.value as RelativeDirection)
                  }
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="before">Before</option>
                  <option value="after">After</option>
                </select>
              </Field>
            </div>

            <div className="mt-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
                Relative to
              </div>
              <div className="mt-1.5 flex flex-wrap gap-3">
                {(
                  [
                    { value: "deadline", label: "Deadline" },
                    { value: "task", label: "Task" },
                    { value: "document", label: "Document" },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className="inline-flex items-center gap-1.5 text-sm text-text"
                  >
                    <input
                      type="radio"
                      name="relative-anchor"
                      value={opt.value}
                      checked={relativeAnchor === opt.value}
                      onChange={() => setRelativeAnchor(opt.value)}
                      className="h-3.5 w-3.5 accent-brand-600"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <Field label="Related item">
                <input
                  type="text"
                  value={relativeItem}
                  onChange={(e) => setRelativeItem(e.target.value)}
                  placeholder="e.g. Property Disclosure"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </Field>
            </div>
          </div>

          {/* Tell Atlas what to do */}
          <Field label="Tell Atlas what to do">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </Field>

          {/* Notes */}
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </Field>

          {/* Related compliance item */}
          <Field label="Related compliance item">
            <input
              type="text"
              value={relatedCompliance}
              onChange={(e) => setRelatedCompliance(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-muted hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500"
          >
            <Check className="h-4 w-4" />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-brand-600" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
