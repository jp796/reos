"use client";

import { toDateInputValue } from "@/lib/dates";

/**
 * TaskPanel
 *
 * TC work queue for a transaction. Separate from milestones — milestones
 * track DATES ("inspection deadline Apr 30"); tasks track WORK ("verify
 * earnest money wired", "forward exec'd contract to lender").
 *
 * Features:
 *   - Inline checkbox toggles completed
 *   - Inline date-edit (click the date chip)
 *   - Priority dropdown (low/normal/high/urgent)
 *   - Assignee dropdown (coordinator/agent/client/lender/title/inspector)
 *   - Delete per row
 *   - "+ Add task" quick-entry
 *   - "Seed checklist" button — applies state/side-aware TaskTemplates
 *     when the panel is empty (first visit to a new transaction)
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Sparkles,
  CheckCircle2,
  Circle,
  AlertOctagon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/app/ToastProvider";

interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  completedAt: string | null;
  assignedTo: string | null;
  priority: string;
  milestoneId: string | null;
}

const ASSIGNEE_OPTIONS = [
  "coordinator",
  "agent",
  "client",
  "lender",
  "title",
  "inspector",
] as const;

const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function priorityClasses(p: string): string {
  switch (p) {
    case "urgent":
      return "border-red-300 bg-red-50 text-red-700";
    case "high":
      return "border-amber-300 bg-amber-50 text-amber-800";
    case "normal":
      return "border-border bg-surface-2 text-text-muted";
    case "low":
    default:
      return "border-border bg-surface text-text-subtle";
  }
}

function isOverdue(t: Task): boolean {
  if (t.completedAt || !t.dueAt) return false;
  return new Date(t.dueAt) < new Date();
}

export function TaskPanel({
  transactionId,
  initial,
}: {
  transactionId: string;
  initial: Task[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Task[]>(initial);
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newAssignee, setNewAssignee] = useState("coordinator");

  async function patchTask(tid: string, patch: Partial<Task>) {
    const prev = items.find((t) => t.id === tid);
    if (!prev) return;
    setItems((cur) => cur.map((t) => (t.id === tid ? { ...t, ...patch } : t)));
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/tasks/${tid}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? res.statusText);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setItems((cur) => cur.map((t) => (t.id === tid ? prev : t)));
      toast.error(
        "Couldn't save task",
        e instanceof Error ? e.message : "unknown",
      );
    }
  }

  async function deleteTask(tid: string) {
    if (!window.confirm("Delete this task?")) return;
    const prev = items;
    setItems((cur) => cur.filter((t) => t.id !== tid));
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/tasks/${tid}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(res.statusText);
      startTransition(() => router.refresh());
    } catch (e) {
      setItems(prev);
      toast.error(
        "Delete failed",
        e instanceof Error ? e.message : "unknown",
      );
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const res = await fetch(`/api/transactions/${transactionId}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          dueAt: newDate || null,
          assignedTo: newAssignee,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setItems((cur) => [...cur, data.task]);
      setNewTitle("");
      setNewDate("");
      setAdding(false);
      startTransition(() => router.refresh());
      toast.success("Task added");
    } catch (e) {
      toast.error(
        "Add failed",
        e instanceof Error ? e.message : "unknown",
      );
    }
  }

  async function seedChecklist() {
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/tasks?seed=1`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      toast.success(
        "Checklist seeded",
        `${data.created} new task(s), ${data.skipped} already existed`,
      );
      startTransition(() => router.refresh());
      // Pull fresh list
      const listRes = await fetch(
        `/api/transactions/${transactionId}/tasks`,
      );
      const listData = await listRes.json();
      setItems(listData.items ?? []);
    } catch (e) {
      toast.error(
        "Seed failed",
        e instanceof Error ? e.message : "unknown",
      );
    }
  }

  const open = items.filter((t) => !t.completedAt);
  const done = items.filter((t) => t.completedAt);
  const overdueCount = open.filter(isOverdue).length;

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          Tasks{" "}
          <span className="font-normal text-text-muted">
            · {open.length} open
            {overdueCount > 0 && (
              <span className="ml-1 text-danger">· {overdueCount} overdue</span>
            )}
            {done.length > 0 && (
              <span className="ml-1 text-text-subtle">· {done.length} done</span>
            )}
          </span>
        </h2>
        <div className="flex items-center gap-1.5">
          {items.length === 0 && (
            <button
              type="button"
              onClick={seedChecklist}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:border-brand-500 disabled:opacity-50"
              title="Seed the state/side-aware TC checklist"
            >
              <Sparkles className="h-3 w-3" strokeWidth={2} />
              Seed checklist
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium hover:border-brand-500 hover:text-brand-700"
          >
            {adding ? "Cancel" : "+ Add task"}
          </button>
        </div>
      </div>

      {adding && (
        <form
          onSubmit={addTask}
          className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_140px_130px_auto]"
        >
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title (e.g. 'Follow up on appraisal')"
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
            required
            autoFocus
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
            title="Leave blank for a checklist item without a date"
          />
          <select
            value={newAssignee}
            onChange={(e) => setNewAssignee(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
          >
            {ASSIGNEE_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
          >
            Add
          </button>
        </form>
      )}

      {items.length === 0 && !adding && (
        <div className="rounded border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
          No tasks yet. Click <b>Seed checklist</b> above to auto-create
          the TC workflow for this side + state, or <b>+ Add task</b> to
          start one manually.
        </div>
      )}

      {open.length > 0 && (
        <ul className="space-y-1.5">
          {open.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onPatch={(patch) => patchTask(t.id, patch)}
              onDelete={() => deleteTask(t.id)}
            />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-text-muted hover:text-text">
            {done.length} completed
          </summary>
          <ul className="mt-2 space-y-1.5">
            {done.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onPatch={(patch) => patchTask(t.id, patch)}
                onDelete={() => deleteTask(t.id)}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TaskRow({
  task,
  onPatch,
  onDelete,
}: {
  task: Task;
  onPatch: (patch: Partial<Task>) => void;
  onDelete: () => void;
}) {
  const overdue = isOverdue(task);
  const [editingDate, setEditingDate] = useState(false);
  const [dateVal, setDateVal] = useState(toDateInputValue(task.dueAt));

  function toggleComplete() {
    onPatch({
      completedAt: task.completedAt ? null : new Date().toISOString(),
    });
  }

  function saveDate() {
    onPatch({ dueAt: dateVal || null });
    setEditingDate(false);
  }

  return (
    <li
      className={cn(
        "group flex flex-wrap items-start gap-2 rounded border px-3 py-2 text-sm transition-colors",
        task.completedAt
          ? "border-border bg-surface-2/50 opacity-70"
          : overdue
            ? "border-red-200 bg-red-50/40"
            : "border-border bg-surface hover:border-border-strong",
      )}
    >
      <button
        type="button"
        onClick={toggleComplete}
        className={cn(
          "mt-0.5 shrink-0 text-text-muted hover:text-brand-600",
          task.completedAt && "text-emerald-600",
        )}
        title={task.completedAt ? "Mark incomplete" : "Mark complete"}
      >
        {task.completedAt ? (
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
        ) : (
          <Circle className="h-4 w-4" strokeWidth={1.8} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "font-medium",
              task.completedAt && "line-through",
            )}
          >
            {task.title}
          </span>
          {overdue && (
            <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
              <AlertOctagon className="h-3 w-3" strokeWidth={2} />
              overdue
            </span>
          )}
        </div>
        {task.description && (
          <div className="mt-0.5 text-xs text-text-muted">
            {task.description}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {editingDate ? (
          <>
            <input
              type="date"
              value={dateVal}
              onChange={(e) => setDateVal(e.target.value)}
              className="rounded border border-border px-1.5 py-0.5 text-xs"
              autoFocus
            />
            <button
              type="button"
              onClick={saveDate}
              className="rounded bg-brand-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-brand-500"
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingDate(false);
                setDateVal(toDateInputValue(task.dueAt));
              }}
              className="text-[11px] text-text-muted hover:text-text"
            >
              cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditingDate(true)}
            className={cn(
              "rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors",
              task.dueAt
                ? "border-border bg-surface text-text-muted hover:border-border-strong"
                : "border-dashed border-border bg-surface text-text-subtle hover:border-border-strong",
            )}
            title="Edit due date"
          >
            {task.dueAt ? fmtDate(task.dueAt) : "+ date"}
          </button>
        )}
        <select
          value={task.priority}
          onChange={(e) => onPatch({ priority: e.target.value })}
          className={cn(
            "rounded border px-1.5 py-0.5 text-[11px] font-medium focus:outline-none",
            priorityClasses(task.priority),
          )}
          title="Priority"
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={task.assignedTo ?? "coordinator"}
          onChange={(e) => onPatch({ assignedTo: e.target.value })}
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-muted focus:outline-none"
          title="Assignee"
        >
          {ASSIGNEE_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-text-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger group-hover:opacity-100"
          title="Delete task"
        >
          <Trash2 className="h-3 w-3" strokeWidth={1.8} />
        </button>
      </div>
    </li>
  );
}
