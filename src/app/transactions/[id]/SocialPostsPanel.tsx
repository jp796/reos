"use client";

/**
 * SocialPostsPanel — generate ready-to-post captions for the
 * three milestone events (Just Listed / Under Contract / Just
 * Sold). One click per platform → copy to clipboard → paste into
 * Instagram / Facebook / LinkedIn / etc.
 */

import { useState } from "react";
import { Sparkles, Copy, Check, Megaphone } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

type EventKey = "new_listing" | "under_contract" | "sold";

interface Bundle {
  event: EventKey;
  instagram: string;
  facebook: string;
  linkedin: string;
  hashtags: string[];
}

const EVENT_LABEL: Record<EventKey, string> = {
  new_listing: "Just Listed",
  under_contract: "Under Contract",
  sold: "Just Sold",
};

export function SocialPostsPanel({
  transactionId,
  defaultEvent,
}: {
  transactionId: string;
  defaultEvent: EventKey;
}) {
  const toast = useToast();
  const [event, setEvent] = useState<EventKey>(defaultEvent);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/social-posts`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setBundle(data.bundle as Bundle);
    } catch (e) {
      toast.error("Generate failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Megaphone className="h-4 w-4 text-text-muted" strokeWidth={1.8} />
          Social posts
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value as EventKey)}
            className="rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs"
          >
            <option value="new_listing">Just Listed</option>
            <option value="under_contract">Under Contract</option>
            <option value="sold">Just Sold</option>
          </select>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            {busy ? "Generating…" : bundle ? "Regenerate" : "Generate"}
          </button>
        </div>
      </header>

      {!bundle ? (
        <p className="text-xs text-text-muted">
          Click <span className="font-medium">Generate</span> to draft an{" "}
          <span className="font-medium">{EVENT_LABEL[event]}</span> announcement
          for Instagram, Facebook, and LinkedIn.
        </p>
      ) : (
        <div className="space-y-3">
          {(
            [
              { key: "instagram", label: "Instagram", text: bundle.instagram },
              { key: "facebook", label: "Facebook", text: bundle.facebook },
              { key: "linkedin", label: "LinkedIn", text: bundle.linkedin },
            ] as const
          ).map((p) => (
            <div
              key={p.key}
              className="rounded-md border border-border bg-surface-2/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {p.label}
                </span>
                <button
                  type="button"
                  onClick={() => copy(p.text, p.key)}
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] hover:border-brand-500"
                >
                  {copiedKey === p.key ? (
                    <Check className="h-3 w-3 text-emerald-600" strokeWidth={2} />
                  ) : (
                    <Copy className="h-3 w-3" strokeWidth={2} />
                  )}
                  {copiedKey === p.key ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm text-text">{p.text}</p>
            </div>
          ))}

          {bundle.hashtags.length > 0 && (
            <div className="rounded-md border border-border bg-surface-2/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Hashtags
                </span>
                <button
                  type="button"
                  onClick={() => copy(bundle.hashtags.join(" "), "hashtags")}
                  className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] hover:border-brand-500"
                >
                  {copiedKey === "hashtags" ? (
                    <Check className="h-3 w-3 text-emerald-600" strokeWidth={2} />
                  ) : (
                    <Copy className="h-3 w-3" strokeWidth={2} />
                  )}
                  {copiedKey === "hashtags" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-sm text-text">{bundle.hashtags.join(" ")}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
