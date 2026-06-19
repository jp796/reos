"use client";

/**
 * TelegramNudge — one-time post-login banner prompting the user to
 * connect their own Telegram so they can talk to Atlas by text. Server
 * only renders this when Telegram is configured AND the user hasn't
 * linked yet; the client adds a dismiss (remembered per browser).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Send, X } from "lucide-react";

const KEY = "reos_dismiss_tg_nudge";

export function TelegramNudge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(localStorage.getItem(KEY) !== "1");
  }, []);
  if (!show) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
      <div className="flex items-center gap-2.5 text-sm text-text">
        <Send className="h-4 w-4 shrink-0 text-brand-600" />
        <span>
          <b>Talk to Atlas on Telegram.</b> Connect your phone to ask about
          deals and take actions by text.{" "}
          <Link href="/settings/notifications" className="font-medium text-brand-700 underline">
            Connect now
          </Link>
        </span>
      </div>
      <button
        onClick={() => {
          localStorage.setItem(KEY, "1");
          setShow(false);
        }}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-text-muted hover:bg-brand-100 hover:text-text"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
