"use client";

/**
 * InspectionsPanel — schedule actual inspection appointments + push
 * each one to Google Calendar with one click. Sits below the facts
 * grid on the transaction detail page.
 *
 * Each row captures:
 *   - kind (general / pest / radon / sewer / chimney / pool / survey)
 *   - label (free text — "General home inspection", default from kind)
 *   - scheduledAt (date+time)
 *   - vendorNote (which inspector, phone, etc.)
 *   - remindOnTelegram (default true — morning brief surfaces it)
 *   - calendarEventId (set by Sync to calendar)
 *
 * The contract DEADLINE for inspection (Transaction.inspectionDate)
 * is not editable here — it lives in the timeline / contract panel.
 */

import { useState } from "react";
import {
  Plus,
  Trash2,
  CalendarPlus,
  Loader2,
  CheckCircle2,
  Bell,
  BellOff,
} from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Inspection {
  id: string;
  kind: string;
  label: string;
  scheduledAt: string | null;
  vendorNote: string | null;
  remindOnTelegram: boolean;
  calendarEventId: string | null;
  completedAt: string | null;
}

const KINDS: Array<{ value: string; label: string }> = [
  { value: "general", label: "General home" },
  { value: "pest", label: "Pest" },
  { value: "radon", label: "Radon" },
  { value: "sewer", label: "Sewer scope" },
  { value: "chimney", label: "Chimney" },
  { value: "pool", label: "Pool / spa" },
  { value: "survey", label: "Survey" },
  { value: "other", label: "Other" },
];

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

  async function add() {
    setAdding(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/inspections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "general",
          label: "General home inspection",
          remindOnTelegram: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "create failed");
      setRows((prev) => [...prev, data.inspection]);
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

  function fmtDate(s: string | null): string {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function toLocalInputValue(s: string | null): string {
    if (!s) return "";
    const d = new Date(s);
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 16);
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold">Inspections</h2>
          <p className="text-xs text-text-muted">
            Schedule the actual inspector visit. Sync each one to your
            calendar; reminders fire in the morning brief.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-text-muted">
          <span>
            Inspection deadline:{" "}
            <span className="font-medium text-text">
              {fmtDate(inspectionDeadline)}
            </span>
          </span>
          <span>
            Objection deadline:{" "}
            <span className="font-medium text-text">
              {fmtDate(inspectionObjectionDeadline)}
            </span>
          </span>
        </div>
      </header>

      {rows.length === 0 && (
        <div className="rounded border border-dashed border-border bg-surface-2/40 px-3 py-4 text-center text-xs text-text-muted">
          No inspections scheduled yet. Click +&nbsp;Add to schedule one.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const synced = !!r.calendarEventId;
          const completed = !!r.completedAt;
          return (
            <div
              key={r.id}
              className={`rounded-md border bg-surface-2 p-3 ${
                completed ? "border-emerald-500/40" : "border-border"
              }`}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
                <select
                  value={r.kind}
                  onChange={(e) =>
                    patch(r.id, {
                      kind: e.target.value,
                      // Auto-update label if it still reflects the
                      // previous default
                      label:
                        r.label ===
                        KINDS.find((k) => k.value === r.kind)?.label
                          ? KINDS.find((k) => k.value === e.target.value)
                              ?.label ?? r.label
                          : r.label,
                    })
                  }
                  className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-text sm:col-span-2"
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={r.label}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((p) =>
                        p.id === r.id ? { ...p, label: e.target.value } : p,
                      ),
                    )
                  }
                  onBlur={(e) =>
                    e.target.value !== r.label &&
                    patch(r.id, { label: e.target.value })
                  }
                  placeholder="What inspection?"
                  className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-text placeholder:text-text-subtle sm:col-span-3"
                />
                <input
                  type="datetime-local"
                  value={toLocalInputValue(r.scheduledAt)}
                  onChange={(e) =>
                    patch(r.id, {
                      scheduledAt: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                  className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-text sm:col-span-3"
                />
                <input
                  type="text"
                  value={r.vendorNote ?? ""}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((p) =>
                        p.id === r.id
                          ? { ...p, vendorNote: e.target.value }
                          : p,
                      ),
                    )
                  }
                  onBlur={(e) =>
                    (e.target.value || null) !== r.vendorNote &&
                    patch(r.id, { vendorNote: e.target.value || null })
                  }
                  placeholder="Vendor / notes"
                  className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-text placeholder:text-text-subtle sm:col-span-2"
                />
                <div className="flex items-center justify-end gap-1 sm:col-span-2">
                  <button
                    type="button"
                    onClick={() =>
                      patch(r.id, { remindOnTelegram: !r.remindOnTelegram })
                    }
                    title={
                      r.remindOnTelegram
                        ? "Telegram reminders on — click to mute"
                        : "Telegram reminders muted — click to enable"
                    }
                    disabled={busyId === r.id}
                    className={`rounded p-1.5 text-text-muted hover:text-text ${
                      r.remindOnTelegram ? "text-brand-600" : ""
                    } disabled:opacity-50`}
                  >
                    {r.remindOnTelegram ? (
                      <Bell className="h-3.5 w-3.5" strokeWidth={2} />
                    ) : (
                      <BellOff className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => syncCalendar(r.id)}
                    disabled={
                      busyId === r.id || !r.scheduledAt || synced
                    }
                    title={
                      synced
                        ? "Already on calendar"
                        : !r.scheduledAt
                          ? "Set a date/time first"
                          : "Sync to Google Calendar"
                    }
                    className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] hover:border-brand-500 disabled:opacity-50"
                  >
                    {busyId === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : synced ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" strokeWidth={2} />
                    ) : (
                      <CalendarPlus className="h-3 w-3" strokeWidth={2} />
                    )}
                    {synced ? "Synced" : "Sync"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    disabled={busyId === r.id}
                    className="rounded p-1.5 text-text-muted hover:bg-surface hover:text-danger disabled:opacity-50"
                    title="Remove inspection"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-text-muted">
          Are there any additional inspections?
        </p>
        <button
          type="button"
          onClick={add}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-brand-500 disabled:opacity-50"
        >
          {adding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          Add inspection
        </button>
      </div>
    </section>
  );
}
