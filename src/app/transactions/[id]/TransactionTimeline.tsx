"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Milestone {
  id: string;
  type: string;
  label: string;
  /** null = date-less checklist item. Timeline renders as "needs date",
   * calendar sync skips, tone is "undated". */
  dueAt: string | null;
  completedAt: string | null;
  status: string;
  ownerRole: string;
  source: string;
}

type Tone =
  | "past"
  | "today"
  | "soon"
  | "overdue"
  | "future"
  | "complete"
  | "undated";

interface Props {
  transactionId: string;
  initialMilestones: Milestone[];
  effectiveDate: string | null;
  closingDate: string | null;
}

const OWNER_CHOICES = ["agent", "lender", "title", "inspector", "client", "coagent"];

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function rel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days}d`;
  return `${-days}d ago`;
}
function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** Sort key for milestones. Date-less (null dueAt) sort to the END,
 * so the timeline shows real deadlines first and undated checklist
 * items pool at the bottom. */
function dueAtKey(m: { dueAt: string | null }): number {
  if (!m.dueAt) return Number.MAX_SAFE_INTEGER;
  const t = new Date(m.dueAt).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function toneFor(m: Milestone): Tone {
  if (m.completedAt) return "complete";
  if (!m.dueAt) return "undated";
  const now = dayStart(new Date());
  const due = dayStart(new Date(m.dueAt));
  const days = (due.getTime() - now.getTime()) / (86400_000);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "soon";
  return "future";
}

function toneClasses(t: Tone): {
  dot: string;
  card: string;
  chip: string;
  chipText: string;
  rail: string;
} {
  switch (t) {
    case "complete":
      return {
        dot: "bg-emerald-500 border-emerald-600",
        card: "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/40",
        chip: "bg-emerald-100 dark:bg-emerald-900",
        chipText: "text-emerald-800 dark:text-emerald-200",
        rail: "bg-emerald-300 dark:bg-emerald-700",
      };
    case "overdue":
      return {
        dot: "bg-red-500 border-red-600",
        card: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40",
        chip: "bg-red-100 dark:bg-red-900",
        chipText: "text-red-800 dark:text-red-200",
        rail: "bg-red-300 dark:bg-red-700",
      };
    case "today":
      return {
        dot: "bg-amber-500 border-amber-600",
        card:
          "border-amber-300 bg-amber-50/80 ring-1 ring-amber-200 " +
          "dark:border-amber-800 dark:bg-amber-950/50 dark:ring-amber-900",
        chip: "bg-amber-100 dark:bg-amber-900",
        chipText: "text-amber-800 dark:text-amber-200",
        rail: "bg-amber-300 dark:bg-amber-700",
      };
    case "soon":
      return {
        dot: "bg-amber-300 border-amber-500",
        card: "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30",
        chip: "bg-amber-50 dark:bg-amber-950",
        chipText: "text-amber-700 dark:text-amber-300",
        rail: "bg-amber-200 dark:bg-amber-800",
      };
    case "undated":
      return {
        dot: "bg-surface-2 border-border",
        card: "border-dashed border-border bg-surface-2/40",
        chip: "bg-surface-2",
        chipText: "text-text-subtle",
        rail: "bg-surface-2",
      };
    case "future":
    default:
      return {
        dot: "bg-surface border-border-strong",
        card: "border-border bg-surface",
        chip: "bg-surface-2",
        chipText: "text-text-muted",
        rail: "bg-surface-2",
      };
  }
}

function toneLabel(t: Tone): string {
  switch (t) {
    case "complete":
      return "Complete";
    case "overdue":
      return "Overdue";
    case "today":
      return "Due today";
    case "soon":
      return "Due soon";
    case "future":
      return "Upcoming";
    case "undated":
      return "No date yet";
    default:
      return "";
  }
}

interface TimelineItem {
  kind: "milestone" | "today";
  at: Date;
  milestone?: Milestone;
}

export function TransactionTimeline(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [milestones, setMilestones] = useState(
    [...props.initialMilestones].sort(
      (a, b) => dueAtKey(a) - dueAtKey(b),
    ),
  );
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Stats
  const stats = useMemo(() => {
    let complete = 0;
    let overdue = 0;
    let upcoming = 0;
    for (const m of milestones) {
      const t = toneFor(m);
      if (t === "complete") complete++;
      else if (t === "overdue") overdue++;
      else upcoming++;
    }
    return { total: milestones.length, complete, overdue, upcoming };
  }, [milestones]);

  // Inject "TODAY" divider into the sorted list. Date-less
  // milestones sort last (via dueAtKey) — rendered after everything
  // else with "at" pinned to now so the layout doesn't break.
  const items: TimelineItem[] = useMemo(() => {
    const now = new Date();
    const out: TimelineItem[] = [];
    let inserted = false;
    for (const m of milestones) {
      const d = m.dueAt ? new Date(m.dueAt) : null;
      if (!inserted && d && d >= now) {
        out.push({ kind: "today", at: now });
        inserted = true;
      }
      out.push({ kind: "milestone", at: d ?? now, milestone: m });
    }
    if (!inserted) out.push({ kind: "today", at: now });
    return out;
  }, [milestones]);

  async function updateMilestone(
    mid: string,
    patch: {
      dueAt?: string | null;
      label?: string;
      completedAt?: string | null;
      ownerRole?: string;
    },
  ) {
    setErr(null);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/milestones/${mid}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      const updated = data.milestone as Milestone;
      setMilestones((prev) =>
        prev
          .map((m) => (m.id === mid ? updated : m))
          .sort((a, b) => dueAtKey(a) - dueAtKey(b)),
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "update failed");
    }
  }

  async function deleteMilestone(mid: string) {
    if (!window.confirm("Delete this milestone?")) return;
    setErr(null);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/milestones/${mid}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json();
        setErr(data.error ?? res.statusText);
        return;
      }
      setMilestones((prev) => prev.filter((m) => m.id !== mid));
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "delete failed");
    }
  }

  // Add-milestone form
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  // Start empty so blank = date-less checklist item by default.
  const [newDate, setNewDate] = useState("");
  const [newOwner, setNewOwner] = useState("agent");
  const [savingNew, setSavingNew] = useState(false);

  async function addMilestone(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setSavingNew(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/transactions/${props.transactionId}/milestones`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: newLabel.trim(),
            // Empty date → date-less checklist item
            dueAt: newDate || null,
            ownerRole: newOwner,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? res.statusText);
        return;
      }
      setMilestones((prev) =>
        [...prev, data.milestone].sort((a, b) => dueAtKey(a) - dueAtKey(b)),
      );
      setNewLabel("");
      setNewDate("");
      setNewOwner("agent");
      setAdding(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "add failed");
    } finally {
      setSavingNew(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-medium">Timeline</h2>
          <span className="text-xs text-text-muted">
            {stats.complete} complete
            {stats.overdue > 0 && (
              <>
                {" · "}
                <span className="text-red-700">{stats.overdue} overdue</span>
              </>
            )}
            {" · "}
            {stats.upcoming} upcoming
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {props.effectiveDate && (
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">
              Effective {fmt(props.effectiveDate)}
            </span>
          )}
          {props.closingDate && (
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">
              Closing {fmt(props.closingDate)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded border border-border-strong bg-surface px-2 py-1 hover:border-border-strong"
          >
            {adding ? "Cancel" : "+ Add milestone"}
          </button>
        </div>
      </div>

      {adding && (
        <form
          onSubmit={addMilestone}
          className="mb-4 grid grid-cols-1 gap-2 rounded-md border border-border bg-surface p-3 sm:grid-cols-[1fr_150px_140px_auto]"
        >
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Milestone label (e.g. 'HOA docs due')"
            className="rounded border border-border-strong px-2 py-1.5 text-sm"
            required
            autoFocus
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded border border-border-strong px-2 py-1.5 text-sm"
            placeholder="Optional"
            title="Leave blank for a date-less checklist item"
          />
          <select
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            className="rounded border border-border-strong bg-surface px-2 py-1.5 text-sm"
          >
            {OWNER_CHOICES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={savingNew}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {savingNew ? "Adding…" : "Add"}
          </button>
        </form>
      )}

      {err && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* vertical rail */}
        <div
          aria-hidden="true"
          className="absolute left-3 top-2 bottom-2 w-px bg-surface-2"
        />
        <ul className="space-y-2">
          {items.map((item, i) => {
            if (item.kind === "today") {
              return (
                <li
                  key={`today-${i}`}
                  className="relative flex items-center gap-3 py-1"
                >
                  <span className="relative z-10 h-3 w-3 rounded-full border-2 border-neutral-900 bg-brand-600" />
                  <span className="text-xs font-medium uppercase tracking-wide text-text">
                    Today · {fmt(item.at.toISOString())}
                  </span>
                  <div className="h-px flex-1 bg-brand-600" />
                </li>
              );
            }
            const m = item.milestone!;
            const tone = toneFor(m);
            const tc = toneClasses(tone);
            const isEdit = editId === m.id;
            return (
              <li key={m.id} className="relative flex items-start gap-3">
                <span
                  className={`relative z-10 mt-2 h-3 w-3 shrink-0 rounded-full border-2 ${tc.dot}`}
                />
                <div
                  className={`flex-1 rounded-md border px-3 py-2 ${tc.card}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text">
                          {m.label}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${tc.chip} ${tc.chipText}`}
                        >
                          {toneLabel(tone)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-text-muted">
                        Owner {m.ownerRole} · source {m.source}
                        {m.completedAt && (
                          <>
                            {" · completed "}
                            {fmt(m.completedAt)}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2 text-sm">
                      {m.dueAt ? (
                        <>
                          <span className="font-medium">{fmt(m.dueAt)}</span>
                          <span className="text-xs text-text-muted">
                            {rel(m.dueAt)}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs italic text-text-subtle">
                          no date
                        </span>
                      )}
                    </div>
                  </div>

                  {isEdit ? (
                    <EditRow
                      milestone={m}
                      onClose={() => setEditId(null)}
                      onSave={(patch) => {
                        void updateMilestone(m.id, patch);
                        setEditId(null);
                      }}
                      onDelete={() => {
                        void deleteMilestone(m.id);
                        setEditId(null);
                      }}
                    />
                  ) : (
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      {!m.completedAt ? (
                        <button
                          type="button"
                          onClick={() =>
                            updateMilestone(m.id, {
                              completedAt: new Date().toISOString(),
                            })
                          }
                          className="rounded border border-border-strong bg-surface px-1.5 py-0.5 hover:border-emerald-500 hover:text-emerald-700"
                        >
                          Mark complete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            updateMilestone(m.id, { completedAt: null })
                          }
                          className="rounded border border-border-strong bg-surface px-1.5 py-0.5 hover:border-border-strong"
                        >
                          Un-complete
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditId(m.id)}
                        className="text-text-muted hover:text-text"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {items.length === 1 && (
          <p className="mt-4 text-sm text-text-muted">
            No milestones yet. Add one manually, or apply a contract to
            generate the timeline automatically.
          </p>
        )}
      </div>
    </section>
  );
}

function EditRow({
  milestone,
  onClose,
  onSave,
  onDelete,
}: {
  milestone: Milestone;
  onClose: () => void;
  onSave: (patch: {
    dueAt: string | null;
    label: string;
    ownerRole: string;
  }) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(milestone.label);
  const [dueAt, setDueAt] = useState(milestone.dueAt?.slice(0, 10) ?? "");
  const [ownerRole, setOwnerRole] = useState(milestone.ownerRole);

  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_auto_130px_auto_auto]">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="rounded border border-border-strong px-2 py-1 text-sm"
      />
      <input
        type="date"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        className="rounded border border-border-strong px-2 py-1 text-sm"
      />
      {/* Clear-date quick action — turns the milestone into a date-less
          checklist item. Calendar sync will skip it; timeline shows
          "no date" in italic. */}
      <button
        type="button"
        onClick={() => setDueAt("")}
        disabled={dueAt === ""}
        className="rounded border border-border bg-surface px-2 py-1 text-[11px] text-text-muted hover:border-border-strong hover:text-text disabled:opacity-50"
        title="Remove the scheduled date — becomes a date-less checklist item"
      >
        No date
      </button>
      <select
        value={ownerRole}
        onChange={(e) => setOwnerRole(e.target.value)}
        className="rounded border border-border-strong bg-surface px-2 py-1 text-sm"
      >
        {OWNER_CHOICES.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() =>
          onSave({ label, dueAt: dueAt === "" ? null : dueAt, ownerRole })
        }
        className="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-500"
      >
        Save
      </button>
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-text-subtle hover:text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
