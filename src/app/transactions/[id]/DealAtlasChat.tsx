"use client";

/**
 * DealAtlasChat — an in-app, deal-scoped Atlas chat that docks on the
 * right so you can keep a tab / document open on the left and talk to
 * Atlas on the same page (the ListedKit split-panel feel). Same brain as
 * the Telegram bot: reads answer immediately, writes are proposed and
 * held until you confirm.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Send, X, Check, Loader2, Paperclip, Download, FileText, ImageIcon } from "lucide-react";

interface ProposedAction {
  tool: string;
  args: Record<string, unknown>;
  preview: string;
}
type Msg =
  | { role: "user" | "atlas" | "system"; text: string }
  | { role: "proposal"; text: string; actions: ProposedAction[] };
/** A file staged in the composer, inlined as a data URL for one turn. */
interface StagedFile {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export function DealAtlasChat({
  transactionId,
  dealLabel,
}: {
  transactionId: string;
  dealLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  // Files/screenshots staged for the next turn. Read-and-discard: Atlas uses
  // them to answer, REOS never stores them (saving to the deal is separate).
  const [attachments, setAttachments] = useState<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function stageFiles(files: File[]) {
    const next: StagedFile[] = [];
    for (const f of files.slice(0, 6)) {
      if (f.size > 10 * 1024 * 1024) continue; // 10MB per file
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      next.push({ fileName: f.name, mimeType: f.type || "application/octet-stream", dataUrl });
    }
    if (next.length) setAttachments((a) => [...a, ...next].slice(0, 6));
  }

  function onPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault();
      void stageFiles(imgs);
    }
  }

  function downloadReply(text: string) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, open]);

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    const staged = attachments;
    setInput("");
    setAttachments([]);
    setMsgs((m) => [
      ...m,
      {
        role: "user",
        text: text || `(${staged.length} attachment${staged.length === 1 ? "" : "s"})`,
      },
    ]);
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/atlas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, attachments: staged }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Atlas error");
      setMsgs((m) => [...m, { role: "atlas", text: data.text || "Done." }]);
      if (Array.isArray(data.proposedActions) && data.proposedActions.length > 0) {
        setMsgs((m) => [
          ...m,
          {
            role: "proposal",
            text: "Confirm to apply:",
            actions: data.proposedActions as ProposedAction[],
          },
        ]);
      }
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "system", text: e instanceof Error ? e.message : "error" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(actions: ProposedAction[]) {
    setBusy(true);
    // Drop the proposal bubble so it can't be double-fired.
    setMsgs((m) => m.filter((x) => x.role !== "proposal"));
    try {
      const res = await fetch(`/api/transactions/${transactionId}/atlas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ executeActions: actions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "execute failed");
      const lines = (data.results ?? [])
        .map((r: { ok: boolean; summary: string }) => `${r.ok ? "✅" : "⚠️"} ${r.summary}`)
        .join("\n");
      setMsgs((m) => [...m, { role: "system", text: lines || "Done." }]);
      router.refresh();
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "system", text: e instanceof Error ? e.message : "error" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-500"
      >
        <Sparkles className="h-4 w-4" />
        Ask Atlas
      </button>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" />
          <div className="text-sm font-semibold text-text">Atlas</div>
          <span className="max-w-[180px] truncate text-xs text-text-muted">· {dealLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm text-text-muted">
            Ask about this deal, or tell me to do something — &ldquo;add a task to
            call the lender Friday&rdquo;, &ldquo;move to inspection&rdquo;,
            &ldquo;what&rsquo;s the closing date?&rdquo; I confirm before any change.
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "proposal" ? (
            <div key={i} className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm">
              <ul className="mb-2 space-y-1">
                {m.actions.map((a, j) => (
                  <li key={j} className="text-text">
                    {j + 1}. {a.preview}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => confirm(m.actions)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" /> Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setMsgs((x) => x.filter((y) => y.role !== "proposal"))}
                  disabled={busy}
                  className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-muted hover:text-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-lg bg-brand-600 px-3 py-2 text-sm text-white"
                  : m.role === "system"
                    ? "whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted"
                    : "max-w-[85%] whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-sm text-text"
              }
            >
              {m.text}
              {m.role === "atlas" && m.text.length > 120 && (
                <button
                  type="button"
                  onClick={() => downloadReply(m.text)}
                  title="Download this reply"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Atlas is thinking…
          </div>
        )}
      </div>

      <div
        className="border-t border-border p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void stageFiles(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((f, i) => (
              <span
                key={`${f.fileName}-${i}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted"
              >
                {f.mimeType.startsWith("image/") ? (
                  <ImageIcon className="h-3 w-3" />
                ) : (
                  <FileText className="h-3 w-3" />
                )}
                <span className="max-w-[10rem] truncate">{f.fileName}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                  className="text-text-subtle hover:text-red-600"
                  aria-label={`Remove ${f.fileName}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              void stageFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach a file or screenshot"
            className="rounded-md border border-border p-2 text-text-subtle transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            value={input}
            onPaste={onPaste}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask or tell Atlas…"
            className="flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-subtle focus:border-brand-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !input.trim()}
            className="inline-flex items-center justify-center rounded-md bg-brand-600 p-2 text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
