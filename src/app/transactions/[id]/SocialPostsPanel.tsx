"use client";

/**
 * SocialPostsPanel — generate ready-to-post captions for the
 * three milestone events (Just Listed / Under Contract / Just
 * Sold). One click per platform → copy to clipboard → paste into
 * Instagram / Facebook / LinkedIn / etc.
 */

import { useState } from "react";
import { Sparkles, Copy, Check, Megaphone, ImageIcon } from "lucide-react";
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

  // Listing-photo state — lookup is async, may take 5-15s. We show
  // a thumbnail preview when found; user can copy the URL or upload
  // it manually through the existing photo flow.
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoSource, setPhotoSource] = useState<string | null>(null);

  async function findPhoto() {
    setPhotoBusy(true);
    setPhotoUrl(null);
    setPhotoSource(null);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/find-photo`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!data.ok) {
        toast.info(
          "No photo found",
          data.message ??
            "The public listing sites didn't return a match — upload manually.",
        );
        return;
      }
      setPhotoUrl(data.photoUrl);
      setPhotoSource(data.caption ?? data.source);
      toast.success("Photo found", `Source: ${data.caption ?? data.source}`);
    } catch (e) {
      toast.error(
        "Photo lookup failed",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      setPhotoBusy(false);
    }
  }

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
          {/* Find listing photo — best-effort Homes.com → Redfin
              scrape. Returns a preview the user can adopt manually
              or copy. Doesn't auto-persist (avoids ghost-attaching
              the wrong house if scraping picks a near-match). */}
          <button
            type="button"
            onClick={findPhoto}
            disabled={photoBusy}
            title="Try to find a listing photo from Homes.com or Redfin"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium hover:border-brand-500 disabled:opacity-50"
          >
            <ImageIcon className="h-3.5 w-3.5" strokeWidth={2} />
            {photoBusy ? "Searching…" : "Find photo"}
          </button>
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

      {/* Photo preview when found. Shows a small thumbnail, the
          source attribution, and copy / open buttons. The user
          decides what to do with it — caching it on the transaction
          is a future enhancement. */}
      {photoUrl && (
        <div className="mb-3 flex items-start gap-3 rounded border border-border bg-surface-2 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt="Listing photo"
            className="h-20 w-28 flex-none rounded object-cover"
          />
          <div className="flex-1 min-w-0 text-xs">
            <div className="text-text">
              <span className="font-medium">Found via {photoSource}.</span>{" "}
              <span className="text-text-muted">
                Open to verify it&rsquo;s the right house.
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <a
                href={photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-700 underline hover:text-brand-600"
              >
                Open full-size
              </a>
              <button
                type="button"
                onClick={() => copy(photoUrl, "photo-url")}
                className="text-brand-700 underline hover:text-brand-600"
              >
                {copiedKey === "photo-url" ? "Copied!" : "Copy URL"}
              </button>
            </div>
          </div>
        </div>
      )}

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
