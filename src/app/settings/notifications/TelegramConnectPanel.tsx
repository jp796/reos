"use client";

/**
 * TelegramConnectPanel — per-user "talk to Atlas on Telegram" linking.
 *
 * Connect → POST mints a one-time code and returns a t.me deep link;
 * we open it so the user taps Start in Telegram, which binds their chat
 * to their REOS user. We poll status so the card flips to "Connected"
 * without a manual refresh.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Check, Unlink } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

interface Status {
  configured: boolean;
  linked: boolean;
  linkedAt: string | null;
}

export function TelegramConnectPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/telegram/link");
      const data = (await res.json()) as Status;
      setStatus(data);
      if (data.linked && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setWaiting(false);
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/telegram/link", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.deepLink) throw new Error(data.error ?? "couldn't start");
      setDeepLink(data.deepLink);
      setCode(data.code ?? null);
      // Best-effort auto-open; blocked by popup blockers on mobile/after await,
      // so the tappable link + code below are the reliable path.
      try {
        window.open(data.deepLink, "_blank", "noopener");
      } catch {
        /* fall back to the rendered link */
      }
      setWaiting(true);
      // Poll until the webhook binds the chat.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const d = await load();
        if (d?.linked) toast.success("Telegram connected", "Atlas will reply to you there.");
      }, 3000);
    } catch (e) {
      toast.error("Couldn't connect", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await fetch("/api/integrations/telegram/link", { method: "DELETE" });
      await load();
      toast.success("Telegram disconnected", "");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
        <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading Telegram status…
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-sm font-medium text-text">Talk to Atlas on Telegram</div>
        <p className="mt-1 text-xs text-text-muted">
          Telegram isn&rsquo;t set up on this workspace yet. Once the owner
          configures the bot, you&rsquo;ll be able to connect your own chat here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-text">Talk to Atlas on Telegram</div>
          <p className="mt-1 text-xs text-text-muted">
            Connect your phone&rsquo;s Telegram to ask about your deals and take
            actions by text — &ldquo;move 3453 Willard to rehab&rdquo;,
            &ldquo;what&rsquo;s closing this week?&rdquo;. Atlas confirms before any change.
          </p>
        </div>
        {status.linked && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <Check className="h-3 w-3" /> Connected
          </span>
        )}
      </div>

      <div className="mt-3">
        {status.linked ? (
          <button
            onClick={unlink}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium text-text hover:bg-surface disabled:opacity-50"
          >
            <Unlink className="h-3.5 w-3.5" /> Disconnect
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Connect Telegram
          </button>
        )}
        {deepLink && !status.linked && (
          <div className="mt-3 space-y-2 rounded-md border border-border bg-surface-2 p-3">
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
            >
              <Send className="h-3.5 w-3.5" /> Open Telegram &amp; tap Start
            </a>
            <p className="text-xs text-text-muted">
              If that doesn&rsquo;t open Telegram, message{" "}
              <b>@REOSAtlasBot</b> and send:{" "}
              {code ? (
                <code className="rounded bg-surface px-1.5 py-0.5">/start {code}</code>
              ) : (
                <code className="rounded bg-surface px-1.5 py-0.5">/start</code>
              )}
            </p>
            <p className="text-[11px] text-text-subtle">
              This card flips to <b>Connected</b> automatically once you tap Start.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
