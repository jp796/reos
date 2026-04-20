"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Milestone {
  id: string;
  type: string;
  label: string;
  dueAt: string;
  completedAt: string | null;
  status: string;
  ownerRole: string;
  source: string;
}

type Tone = "past" | "today" | "soon" | "overdue" | "future" | "complete";

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
function toneFor(m: Milestone): Tone {
  if (m.completedAt) return "complete";
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
        card: "border-emerald-200 bg-emerald-50/40",
        chip: "bg-emerald-100",
        chipText: "text-emerald-800",
        rail: "bg-emerald-300",
      };
    case "overdue":
      return {
        dot: "bg-red-500 border-red-600",
        card: "border-red-200 bg-red-50/60",
        chip: "bg-red-100",
        chipText: "text-red-800",
        rail: "bg-red-300",
      };
    case "today":
      return {
        dot: "bg-amber-500 border-amber-600",
        card: "border-amber-300 bg-amber-50/80 ring-1 ring-amber-200",
        chip: "bg-amber-100",
        chipText: "text-amber-800",
        rail: "bg-amber-300",
      };
    case "soon":
      return {
        dot: "bg-amber-300 border-amber-500",
        card: "border-amber-200 bg-amber-50/40",
        chip: "bg-amber-50",
        chipText: "text-amber-700",
        rail: "bg-amber-200",
      };
    case "future":
    default:
      return {
        dot: "bg-white border-neutral-300",
        card: "border-neutral-200 bg-white",
        chip: "bg-neutral-100",
        chipText: "text-neutral-600",
        rail: "bg-neutral-200",
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
      (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
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

  // Inject "TODAY" divider into the sorted list
  const items: TimelineItem[] = useMemo(() => {
    const now = new Date();
    const out: TimelineItem[] = [];
    let inserted = false;
    for (const m of milestones) {
      const d = new Date(m.dueAt);
      if (!inserted && d >= now) {
        out.push({ kind: "today", at: now });
        inserted = true;
      }
      out.push({ kind: "milestone", at: d, milestone: m });
    }
    if (!inserted) out.push({ kind: "today", at: now });
    return out;
  }, [milestones]);

  async function updateMilestone(
    mid: string,
    patch: {
      dueAt?: string;
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
          .sort(
            (a, b) =>
              new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
          ),
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
  const [newDate, setNewDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [newOwner, setNewOwner] = useState("agent");
  const [savingNew, setSavingNew] = useState(false);

  async function addMilestone(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || !newDate) return;
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
            dueAt: newDate,
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
        [...prev, data.milestone].sort(
          (a, b) =>
            new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
        ),
      );
      setNewLabel("");
      setNewDate(new Date().toISOString().slice(0, 10));
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
          <span className="text-xs text-neutral-500">
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
            className="rounded border border-neutral-300 bg-white px-2 py-1 hover:border-neutral-500"
          >
            {adding ? "Cancel" : "+ Add milestone"}
          </button>
        </div>
      </div>

      {adding && (
        <form
          onSubmit={addMilestone}
          className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:grid-cols-[1fr_150px_140px_auto]"
        >
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Milestone label (e.g. 'HOA docs due')"
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            required
            autoFocus
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            required
          />
          <select
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
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
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
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
          className="absolute left-3 top-2 bottom-2 w-px bg-neutral-200"
        />
        <ul className="space-y-2">
          {items.map((item, i) => {
            if (item.kind === "today") {
              return (
                <li
                  key={`today-${i}`}
                  className="relative flex items-center gap-3 py-1"
                >
                  <span className="relative z-10 h-3 w-3 rounded-full border-2 border-neutral-900 bg-neutral-900" />
                  <span className="text-xs font-medium uppercase tracking-wide text-neutral-900">
                    Today · {fmt(item.at.toISOString())}
                  </span>
                  <div className="h-px flex-1 bg-neutral-900" />
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
                  className={`flex-1 rounded-lg border px-3 py-2 ${tc.card}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-neutral-900">
                          {m.label}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${tc.chip} ${tc.chipText}`}
                        >
                          {toneLabel(tone)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-500">
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
                      <span className="font-medium">{fmt(m.dueAt)}</span>
                      <span className="text-xs text-neutral-500">
                        {rel(m.dueAt)}
                      </span>
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
                          className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 hover:border-emerald-500 hover:text-emerald-700"
                        >
                          Mark complete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            updateMilestone(m.id, { completedAt: null })
                          }
                          className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 hover:border-neutral-500"
                        >
                          Un-complete
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditId(m.id)}
                        className="text-neutral-500 hover:text-neutral-900"
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
          <p className="mt-4 text-sm text-neutral-500">
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
    dueAt: string;
    label: string;
    ownerRole: string;
  }) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(milestone.label);
  const [dueAt, setDueAt] = useState(milestone.dueAt.slice(0, 10));
  const [ownerRole, setOwnerRole] = useState(milestone.ownerRole);

  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_130px_auto_auto]">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <input
        type="date"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        className="rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <select
        value={ownerRole}
        onChange={(e) => setOwnerRole(e.target.value)}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
      >
        {OWNER_CHOICES.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onSave({ label, dueAt, ownerRole })}
        className="rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-800"
      >
        Save
      </button>
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-neutral-400 hover:text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
