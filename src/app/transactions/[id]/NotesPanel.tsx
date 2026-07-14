"use client";

/**
 * NotesPanel — free-form notes attached to a transaction. Sits
 * directly below the AI Summary. The header shows a red dot when
 * there are unread notes for the current user.
 *
 * Each note row:
 *   - author avatar/initial + name + relative timestamp
 *   - body (multi-line, plain text — line breaks preserved)
 *   - "New" pill when the note is unread by the current user
 *   - delete (author or owner only — server enforces)
 *
 * New-note form:
 *   - textarea
 *   - "Email participants" checkbox (off by default; on flips
 *     notify_email and the API fans out to the share-list)
 *   - "Save note" button
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  StickyNote,
  Mail,
} from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface NoteRow {
  id: string;
  body: string;
  author: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
  read: boolean;
}

/** Render a note body with @mentions highlighted in ink blue. */
function renderWithMentions(body: string) {
  return body.split(/(@[\w.]+)/g).map((part, i) =>
    /^@[\w.]+$/.test(part) ? (
      <span key={i} className="font-medium text-brand-700">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function NotesPanel({
  transactionId,
  currentUserId,
  team = [],
}: {
  transactionId: string;
  currentUserId: string;
  /** Teammates who can be @mentioned (excludes the current user). */
  team?: Array<{ id: string; name: string | null; email: string }>;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<NoteRow[] | null>(null);
  const [draft, setDraft] = useState("");
  const [emailOn, setEmailOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const markedReadRef = useRef<Set<string>>(new Set());

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/transactions/${transactionId}/notes`);
        const data = await res.json();
        if (!cancelled && data.ok) setRows(data.notes ?? []);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  // After the panel renders any unread notes for the current user,
  // auto-mark them as read on the server. Once-per-note locally.
  useEffect(() => {
    if (!rows) return;
    for (const r of rows) {
      if (r.read || markedReadRef.current.has(r.id)) continue;
      markedReadRef.current.add(r.id);
      fetch(`/api/transactions/${transactionId}/notes/${r.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read: true }),
      }).catch(() => {});
    }
  }, [rows, transactionId]);

  const unreadCount = useMemo(
    () => (rows ? rows.filter((r) => !r.read).length : 0),
    [rows],
  );

  const mentionable = useMemo(() => {
    // Teammates first, then a "@Me" chip so you can ping your own Telegram
    // (an "it sent" confirmation + push-to-act).
    const others = team.filter((t) => t.id !== currentUserId);
    const self = team.find((t) => t.id === currentUserId);
    return self ? [...others, self] : others;
  }, [team, currentUserId]);

  /** Insert @FirstName at the cursor (or end) so posting notifies them. */
  function insertMention(u: { name: string | null; email: string }) {
    const handle = "@" + (u.name?.split(/\s+/)[0] ?? u.email.split("@")[0]);
    const el = draftRef.current;
    setDraft((prev) => {
      if (!el) return `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${handle} `;
      const start = el.selectionStart ?? prev.length;
      const before = prev.slice(0, start);
      const after = prev.slice(start);
      const sep = before && !before.endsWith(" ") ? " " : "";
      return `${before}${sep}${handle} ${after}`;
    });
    requestAnimationFrame(() => el?.focus());
  }

  async function add() {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, notifyEmail: emailOn }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      setDraft("");
      setEmailOn(false);
      // Fetch fresh list (need server-side author info on the new row)
      const list = await fetch(
        `/api/transactions/${transactionId}/notes`,
      ).then((r) => r.json());
      setRows(list.notes ?? []);
      toast.success("Note saved", emailOn ? "Share-list emailed." : undefined);
      draftRef.current?.focus();
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/notes/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "delete failed");
      }
      setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusyId(null);
    }
  }

  function fmtRel(iso: string): string {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <StickyNote className="h-4 w-4 text-text-muted" strokeWidth={1.8} />
          Notes
          {unreadCount > 0 && (
            <span
              className="inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white"
              title={`${unreadCount} unread`}
            >
              {unreadCount}
            </span>
          )}
        </h2>
        <span className="text-xs text-text-muted">
          {rows == null
            ? "loading…"
            : rows.length === 0
              ? "No notes yet"
              : `${rows.length} note${rows.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {/* New note */}
      <div className="rounded-md border border-dashed border-border bg-surface-2/40 p-3">
        <textarea
          ref={draftRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Add a note or message the team… @mention to notify"
          className="w-full resize-y rounded border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
        />
        {mentionable.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-text-subtle">Mention:</span>
            {mentionable.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => insertMention(u)}
                title={
                  u.id === currentUserId
                    ? "Ping yourself on Telegram + email (an 'it sent' confirmation)"
                    : `Notify ${u.name ?? u.email} (Telegram + email)`
                }
                className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/30"
              >
                {u.id === currentUserId
                  ? "@Me"
                  : `@${u.name?.split(/\s+/)[0] ?? u.email.split("@")[0]}`}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={emailOn}
              onChange={(e) => setEmailOn(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <Mail className="h-3 w-3" strokeWidth={2} />
            Email the share-list
          </label>
          <button
            type="button"
            onClick={add}
            disabled={saving || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            Save note
          </button>
        </div>
      </div>

      {/* Existing notes */}
      {rows && rows.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => {
            const isAuthor = r.author?.id === currentUserId;
            const isUnread = !r.read;
            return (
              <li
                key={r.id}
                className={`rounded-md border p-3 ${
                  isUnread
                    ? "border-brand-500/60 bg-brand-50/30 dark:border-brand-300/30 dark:bg-brand-50/5"
                    : "border-border bg-surface-2/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {r.author?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.author.image}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded-full border border-border"
                      />
                    ) : (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-text-muted">
                        {(r.author?.name ?? r.author?.email ?? "?")
                          .slice(0, 1)
                          .toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 text-xs">
                      <span className="font-medium text-text">
                        {r.author?.name ?? r.author?.email ?? "Unknown"}
                      </span>
                      <span className="text-text-muted">
                        {" · "}
                        {fmtRel(r.createdAt)}
                      </span>
                      {isUnread && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                          New
                        </span>
                      )}
                    </div>
                  </div>
                  {isAuthor && (
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      disabled={busyId === r.id}
                      className="rounded p-1 text-text-subtle hover:bg-surface hover:text-danger disabled:opacity-50"
                      title="Delete note"
                    >
                      {busyId === r.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      )}
                    </button>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-text">
                  {renderWithMentions(r.body)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
