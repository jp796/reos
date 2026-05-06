"use client";

/**
 * InspectionsPanel — schedule actual inspection appointments + sync
 * each one to Google Calendar.
 *
 * Visual model (per the design Jp approved):
 *  - Sub-section inside the Timeline with a clipboard glyph + status
 *    badge ("Due Soon" if any deadline is within 7d)
 *  - Top fact-row: Inspection deadline / Objection deadline / Source
 *  - Smart deadline-conflict banner when an inspection is scheduled
 *    AFTER the contract inspection deadline
 *  - One card per inspection with:
 *     - Status pill (Scheduled / Synced / Complete / Conflict)
 *     - Read-mode summary by default; Edit toggles inline form
 *     - Vendor block separate from notes (autocomplete past vendors)
 *     - Action bar with context-aware primary button
 *  - Collapsible header (chevron) — once a deal has 4+ items, fold
 *
 * Inspection kinds (per Jp's spec):
 *   Whole home, Partial home, Plumbing, Heating, Electrical,
 *   Foundation, Sewer, Roof, Well and septic, Survey
 */

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  CalendarPlus,
  Loader2,
  CheckCircle2,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ClipboardCheck,
  Clock,
  X as XIcon,
  Pencil,
  MoreHorizontal,
} from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Inspection {
  id: string;
  kind: string;
  label: string;
  scheduledAt: string | null;
  vendorName: string | null;
  vendorNote: string | null;
  remindOnTelegram: boolean;
  calendarEventId: string | null;
  completedAt: string | null;
}

const KINDS: Array<{ value: string; label: string }> = [
  { value: "whole_home", label: "Whole home" },
  { value: "partial_home", label: "Partial home" },
  { value: "plumbing", label: "Plumbing" },
  { value: "heating", label: "Heating" },
  { value: "electrical", label: "Electrical" },
  { value: "foundation", label: "Foundation" },
  { value: "sewer", label: "Sewer" },
  { value: "roof", label: "Roof" },
  { value: "well_septic", label: "Well and septic" },
  { value: "survey", label: "Survey" },
  { value: "other", label: "Other" },
];

function defaultLabelForKind(kind: string): string {
  return (
    KINDS.find((k) => k.value === kind)?.label.toLowerCase() + " inspection"
  ).replace(/^./, (c) => c.toUpperCase());
}

export function InspectionsPanel({
  transactionId,
  initial,
  inspectionDeadline,
  inspectionObjectionDeadline,
}: {
  transactionId: string;
  initial: Inspection[];
  inspectionDeadline: string | null;
  inspectionObjectionDeadline: string | null;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Inspection[]>(initial);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [vendors, setVendors] = useState<string[]>([]);

  // Load vendor autocomplete list once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/transactions/inspection-vendors");
        const data = await res.json();
        if (data?.ok && Array.isArray(data.vendors)) {
          setVendors(
            (data.vendors as Array<{ name: string }>).map((v) => v.name),
          );
        }
      } catch {
        // best-effort only
      }
    })();
  }, []);

  const dueSoon = useMemo(() => {
    const candidates = [inspectionDeadline, inspectionObjectionDeadline].filter(
      Boolean,
    ) as string[];
    return candidates.some((d) => {
      const days = Math.round(
        (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      return days >= 0 && days <= 7;
    });
  }, [inspectionDeadline, inspectionObjectionDeadline]);

  // Conflict: any scheduled inspection AFTER the contract deadline
  const conflictRows = useMemo(() => {
    if (!inspectionDeadline) return [] as string[];
    const deadline = new Date(inspectionDeadline).getTime();
    return rows
      .filter(
        (r) =>
          r.scheduledAt &&
          !r.completedAt &&
          new Date(r.scheduledAt).getTime() > deadline,
      )
      .map((r) => r.id);
  }, [rows, inspectionDeadline]);

  async function add() {
    setAdding(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/inspections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "whole_home",
          label: defaultLabelForKind("whole_home"),
          remindOnTelegram: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "create failed");
      setRows((prev) => [...prev, data.inspection]);
      setEditingId(data.inspection.id);
      setCollapsed(false);
    } catch (e) {
      toast.error("Couldn't add", e instanceof Error ? e.message : "unknown");
    } finally {
      setAdding(false);
    }
  }

  async function patch(id: string, patch: Partial<Inspection>) {
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/inspections/${id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "update failed");
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...data.inspection } : r)),
      );
      // Save vendor name to autocomplete cache
      if (
        patch.vendorName &&
        !vendors.includes(patch.vendorName) &&
        patch.vendorName.trim().length > 0
      ) {
        setVendors((prev) => [patch.vendorName!, ...prev]);
      }
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this inspection? This cannot be undone."))
      return;
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/inspections/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "delete failed");
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusyId(null);
    }
  }

  async function syncCalendar(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/inspections/${id}/sync-calendar`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.connectUrl) {
          toast.error(
            "Google not connected",
            "Open Settings → Integrations to reconnect.",
          );
          return;
        }
        throw new Error(data.error ?? "sync failed");
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, calendarEventId: data.calendarEventId ?? r.calendarEventId }
            : r,
        ),
      );
      toast.success("Synced", "Inspection added to your calendar.");
    } catch (e) {
      toast.error("Sync failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusyId(null);
    }
  }

  async function markComplete(id: string, complete: boolean) {
    await patch(id, {
      completedAt: complete ? new Date().toISOString() : null,
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-4">
      {/* Header — clipboard glyph, title, due-soon badge, collapse toggle */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-100/20 dark:text-amber-300">
            <ClipboardCheck className="h-4 w-4" strokeWidth={2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-semibold">
                Inspection Timeline
              </h3>
              {dueSoon && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-100/20 dark:text-amber-300">
                  Due Soon
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              Schedule the inspector visit. Sync to calendar; reminders fire
              in the morning brief.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-md border border-border bg-surface p-1.5 text-text-muted hover:text-text"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" strokeWidth={2} />
          ) : (
            <ChevronUp className="h-4 w-4" strokeWidth={2} />
          )}
        </button>
      </header>

      {!collapsed && (
        <div className="mt-4 space-y-3">
          {/* Fact row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FactCell
              label="Inspection Deadline"
              value={fmtDate(inspectionDeadline)}
              accentClass="text-amber-600"
            />
            <FactCell
              label="Objection Deadline"
              value={fmtDate(inspectionObjectionDeadline)}
              accentClass="text-violet-500"
            />
            <FactCell
              label="Source"
              value="Contract"
              hint="Pulled from the contract extraction"
              accentClass="text-brand-600"
            />
          </div>

          {/* Conflict banner */}
          {conflictRows.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:border-amber-300/30 dark:bg-amber-100/10 dark:text-amber-200">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                strokeWidth={2}
              />
              <div className="flex-1">
                <div className="font-semibold">
                  Inspection scheduled after the inspection deadline.
                </div>
                <div>
                  Review {conflictRows.length === 1 ? "this date" : "these dates"}{" "}
                  before syncing — buyer's contingency rights end at the
                  contract deadline.
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {rows.length === 0 && (
            <div className="rounded border border-dashed border-border bg-surface px-3 py-6 text-center text-xs text-text-muted">
              No inspections scheduled yet. Click +&nbsp;Add inspection to
              schedule one.
            </div>
          )}

          {/* Inspection cards */}
          {rows.map((r) => (
            <InspectionCard
              key={r.id}
              row={r}
              isEditing={editingId === r.id}
              busy={busyId === r.id}
              vendors={vendors}
              hasConflict={conflictRows.includes(r.id)}
              onEdit={() => setEditingId(r.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(p) =>
                patch(r.id, p).then(() => setEditingId(null))
              }
              onPatch={(p) => patch(r.id, p)}
              onRemove={() => remove(r.id)}
              onSync={() => syncCalendar(r.id)}
              onComplete={(c) => markComplete(r.id, c)}
            />
          ))}

          {/* Add button */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-text-muted">
              {rows.length === 0
                ? "Add the first inspection."
                : "Are there any additional inspections?"}
            </p>
            <button
              type="button"
              onClick={add}
              disabled={adding}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand-500 disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Add inspection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** ───────────────────────────────────────────────────────────────
 * Fact cell — small key/value tile in the top row
 * ───────────────────────────────────────────────────────────── */
function FactCell({
  label,
  value,
  hint,
  accentClass,
}: {
  label: string;
  value: string;
  hint?: string;
  accentClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div
        className={`text-[10px] font-semibold uppercase tracking-wide ${accentClass ?? "text-text-muted"}`}
      >
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-text">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-text-muted">{hint}</div>
      )}
    </div>
  );
}

/** ───────────────────────────────────────────────────────────────
 * Single inspection card — read-mode by default, edit-mode on click
 * ───────────────────────────────────────────────────────────── */
function InspectionCard({
  row,
  isEditing,
  busy,
  vendors,
  hasConflict,
  onEdit,
  onCancelEdit,
  onSave,
  onPatch,
  onRemove,
  onSync,
  onComplete,
}: {
  row: Inspection;
  isEditing: boolean;
  busy: boolean;
  vendors: string[];
  hasConflict: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<Inspection>) => void;
  onPatch: (patch: Partial<Inspection>) => void;
  onRemove: () => void;
  onSync: () => void;
  onComplete: (complete: boolean) => void;
}) {
  const synced = !!row.calendarEventId;
  const completed = !!row.completedAt;
  const inPast = row.scheduledAt
    ? new Date(row.scheduledAt).getTime() < Date.now()
    : false;

  // Status pill (Scheduled / Synced / Conflict / Complete / Pending)
  const status: { label: string; tone: "blue" | "green" | "amber" | "muted" } =
    completed
      ? { label: "Complete", tone: "green" }
      : hasConflict
        ? { label: "Conflict", tone: "amber" }
        : synced
          ? { label: "Synced", tone: "green" }
          : row.scheduledAt
            ? { label: "Scheduled", tone: "blue" }
            : { label: "Pending date", tone: "muted" };

  const toneStyle = {
    blue: "bg-brand-50 text-brand-700 dark:bg-brand-50/20 dark:text-brand-200",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-100/20 dark:text-emerald-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-100/20 dark:text-amber-300",
    muted: "bg-surface-2 text-text-muted",
  }[status.tone];

  // Local edit-mode state (so typing doesn't fire patches every keystroke)
  const [draft, setDraft] = useState({
    label: row.label,
    kind: row.kind,
    scheduledAt: row.scheduledAt,
    vendorName: row.vendorName ?? "",
    vendorNote: row.vendorNote ?? "",
  });

  useEffect(() => {
    if (isEditing) {
      setDraft({
        label: row.label,
        kind: row.kind,
        scheduledAt: row.scheduledAt,
        vendorName: row.vendorName ?? "",
        vendorNote: row.vendorNote ?? "",
      });
    }
  }, [isEditing, row]);

  function commit() {
    onSave({
      label: draft.label,
      kind: draft.kind,
      scheduledAt: draft.scheduledAt,
      vendorName: draft.vendorName.trim() || null,
      vendorNote: draft.vendorNote.trim() || null,
    });
  }

  // Context-aware primary button: Sync when not synced + has date,
  // Mark Complete when synced + past, Reopen when complete.
  const primary: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  } = completed
    ? {
        label: "Reopen",
        icon: <Clock className="h-3.5 w-3.5" strokeWidth={2} />,
        onClick: () => onComplete(false),
      }
    : !synced
      ? {
          label: "Sync to Calendar",
          icon: <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />,
          onClick: onSync,
          disabled: !row.scheduledAt,
        }
      : inPast
        ? {
            label: "Mark Complete",
            icon: <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />,
            onClick: () => onComplete(true),
          }
        : {
            label: "Mark Complete",
            icon: <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />,
            onClick: () => onComplete(true),
          };

  return (
    <article
      className={`rounded-lg border bg-surface p-4 transition-colors ${
        completed
          ? "border-emerald-300/40 dark:border-emerald-300/20"
          : hasConflict
            ? "border-amber-300/60 dark:border-amber-300/30"
            : "border-border"
      }`}
    >
      {/* Top row: kind icon + label + status pill */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-50/20 dark:text-brand-200">
            <ClipboardCheck className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-text">
              {row.label}
            </div>
            <div className="mt-0.5 text-xs text-text-muted">
              {row.scheduledAt ? (
                <>
                  Scheduled for{" "}
                  <span className="font-medium text-brand-700">
                    {fmtDateTime(row.scheduledAt)}
                  </span>
                </>
              ) : (
                <span className="italic">No date set</span>
              )}
            </div>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneStyle}`}
        >
          {status.label}
        </span>
      </div>

      {/* Edit mode form */}
      {isEditing && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-12">
          <div className="sm:col-span-3">
            <label className="text-[10px] uppercase tracking-wide text-text-muted">
              Inspection Type
            </label>
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  kind: e.target.value,
                  // Auto-update label if it still matches the previous default
                  label:
                    d.label === defaultLabelForKind(d.kind)
                      ? defaultLabelForKind(e.target.value)
                      : d.label,
                }))
              }
              className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <label className="text-[10px] uppercase tracking-wide text-text-muted">
              Inspection
            </label>
            <input
              type="text"
              value={draft.label}
              onChange={(e) =>
                setDraft((d) => ({ ...d, label: e.target.value }))
              }
              placeholder="What inspection?"
              className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-5">
            <label className="text-[10px] uppercase tracking-wide text-text-muted">
              Date / Time
            </label>
            <input
              type="datetime-local"
              value={toLocalInputValue(draft.scheduledAt)}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  scheduledAt: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                }))
              }
              className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text"
            />
          </div>

          <div className="sm:col-span-7">
            <label className="text-[10px] uppercase tracking-wide text-text-muted">
              Vendor
            </label>
            <input
              type="text"
              list={`vendor-list-${row.id}`}
              value={draft.vendorName}
              onChange={(e) =>
                setDraft((d) => ({ ...d, vendorName: e.target.value }))
              }
              placeholder="Acme Inspections"
              className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
            />
            <datalist id={`vendor-list-${row.id}`}>
              {vendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div className="sm:col-span-5">
            <label className="text-[10px] uppercase tracking-wide text-text-muted">
              Notes
            </label>
            <input
              type="text"
              value={draft.vendorNote}
              onChange={(e) =>
                setDraft((d) => ({ ...d, vendorNote: e.target.value }))
              }
              placeholder="Phone, schedule details…"
              className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 sm:col-span-12">
            <button
              type="button"
              onClick={onCancelEdit}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:border-border-strong"
            >
              <XIcon className="h-3 w-3" strokeWidth={2} />
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
              )}
              Save
            </button>
          </div>
        </div>
      )}

      {/* Read mode: vendor + notes summary */}
      {!isEditing && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-muted">
          {row.vendorName ? (
            <span>
              <span className="text-text-muted">Vendor:</span>{" "}
              <span className="font-medium text-text">{row.vendorName}</span>
            </span>
          ) : (
            <span className="italic">No vendor assigned</span>
          )}
          {row.vendorNote && (
            <span className="text-text-muted">· {row.vendorNote}</span>
          )}
          {row.remindOnTelegram ? (
            <span className="inline-flex items-center gap-1 text-text-muted">
              <Bell className="h-3 w-3 text-brand-600" strokeWidth={2} />
              Reminders on
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-text-subtle">
              <BellOff className="h-3 w-3" strokeWidth={2} />
              Reminders muted
            </span>
          )}
        </div>
      )}

      {/* Action bar */}
      {!isEditing && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={primary.onClick}
            disabled={busy || primary.disabled}
            title={
              primary.disabled
                ? "Set a date/time first"
                : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : primary.icon}
            {primary.label}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            Edit
          </button>
          {!synced && row.scheduledAt && (
            <button
              type="button"
              onClick={onSync}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50"
            >
              <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />
              Sync
            </button>
          )}
          <button
            type="button"
            onClick={() => onPatch({ remindOnTelegram: !row.remindOnTelegram })}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm hover:border-border-strong disabled:opacity-50"
            title={row.remindOnTelegram ? "Mute reminders" : "Enable reminders"}
          >
            {row.remindOnTelegram ? (
              <Bell className="h-3.5 w-3.5 text-brand-600" strokeWidth={2} />
            ) : (
              <BellOff className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <details className="relative">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong [&::-webkit-details-marker]:hidden">
                <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
                More
              </summary>
              <div className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-md border border-border bg-surface shadow-md">
                <button
                  type="button"
                  onClick={onRemove}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-surface-2"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Delete
                </button>
              </div>
            </details>
          </div>
        </div>
      )}
    </article>
  );
}

/** ───────────────────────────────────────────────────────────────
 * Date helpers
 * ───────────────────────────────────────────────────────────── */
function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtDateTime(s: string): string {
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function toLocalInputValue(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}
