"use client";

/**
 * SocialPostsPanel — generate ready-to-post captions for the
 * three milestone events (Just Listed / Under Contract / Just
 * Sold). One click per platform → copy to clipboard → paste into
 * Instagram / Facebook / LinkedIn / etc.
 */

import { useEffect, useState } from "react";
import { Sparkles, Copy, Check, Megaphone, ImageIcon, Send, Wand2 } from "lucide-react";
import { useToast } from "@/app/ToastProvider";

type PostPlatform = "instagram" | "facebook" | "linkedin";

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

  // Editable copy of the generated captions. We hydrate from `bundle`
  // each time it changes; the user can tweak before clicking Post.
  const [drafts, setDrafts] = useState<Record<PostPlatform, string>>({
    instagram: "",
    facebook: "",
    linkedin: "",
  });
  useEffect(() => {
    if (bundle) {
      setDrafts({
        instagram: bundle.instagram,
        facebook: bundle.facebook,
        linkedin: bundle.linkedin,
      });
    }
  }, [bundle]);

  // Per-platform connection state — drives the "Connect" vs "Post"
  // vs "Pending scope" rendering on each row's Post button.
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null);
  const [liConnected, setLiConnected] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, li] = await Promise.all([
          fetch("/api/auth/meta/status").then((r) => r.json()),
          fetch("/api/auth/linkedin/status").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setMetaConnected(!!meta.connected);
        setLiConnected(!!li.connected);
      } catch {
        if (!cancelled) {
          setMetaConnected(false);
          setLiConnected(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [postingPlatform, setPostingPlatform] = useState<PostPlatform | null>(null);

  // Visual-card state — points at the API endpoint with a cache-bust
  // query so the user can re-render after editing brand/facts.
  const [cardCacheBust, setCardCacheBust] = useState<number | null>(null);
  const cardUrl = cardCacheBust
    ? `/api/transactions/${transactionId}/visual-card?event=${event}&cache-bust=${cardCacheBust}`
    : null;

  async function postTo(platform: PostPlatform) {
    const text = drafts[platform]?.trim();
    if (!text) {
      toast.error("Nothing to post", "Caption is empty.");
      return;
    }
    setPostingPlatform(platform);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/social-post/${platform}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, photoUrl: photoUrl ?? undefined }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 501 && data.reason === "scope_not_granted") {
          toast.info("Pending scope unlock", data.message ?? "");
        } else {
          toast.error("Post failed", data.error ?? data.message ?? res.statusText);
        }
        return;
      }
      const label = platform === "linkedin" ? "LinkedIn" : platform === "facebook" ? "Facebook" : "Instagram";
      toast.success(`Posted to ${label}`, data.postUrl ? "Click toast to open" : "");
      if (data.postUrl) window.open(data.postUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error("Post failed", e instanceof Error ? e.message : "unknown");
    } finally {
      setPostingPlatform(null);
    }
  }

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
          {/* Generate visual card — multi-photo composite branded
              with the account's brand kit + agent block. Hits the
              visual-card route; image streams in. Cache-bust state
              forces a fresh render each click. */}
          <button
            type="button"
            onClick={() => setCardCacheBust(Date.now())}
            title="Render a branded social-post visual card (1200×1500 PNG)"
            className="inline-flex items-center gap-1.5 rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:border-purple-500 hover:bg-purple-100"
          >
            <Wand2 className="h-3.5 w-3.5" strokeWidth={2} />
            Generate visual
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
      {/* Visual-card preview. Image loads from the API directly —
          1200×1500 PNG, branded with the account's brand kit + JP's
          agent block. Right-click to save, or "Open" to use in
          social posts manually (auto-attach lands when posting
          endpoints can read multi-image payloads). */}
      {cardUrl && (
        <div className="mb-3 flex items-start gap-3 rounded border border-purple-300 bg-purple-50 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardUrl}
            alt="Generated visual card"
            className="h-48 w-auto flex-none rounded border border-purple-200 object-contain shadow"
          />
          <div className="flex-1 min-w-0 text-xs text-purple-900">
            <div className="font-medium">Visual card rendered.</div>
            <div className="mt-1 text-purple-800">
              Branded for{" "}
              <span className="font-medium">{EVENT_LABEL[event]}</span> with
              your Real Broker palette + agent block. Right-click → Save
              image. Eventual auto-attach to FB/IG/LinkedIn coming in
              Phase 1B.
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <a
                href={cardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-700 underline hover:text-purple-600"
              >
                Open full-size
              </a>
              <a
                href={cardUrl}
                download={`reos-visual-${event}.png`}
                className="text-purple-700 underline hover:text-purple-600"
              >
                Download PNG
              </a>
              <button
                type="button"
                onClick={() => setCardCacheBust(Date.now())}
                className="text-purple-700 underline hover:text-purple-600"
              >
                Re-render
              </button>
            </div>
          </div>
        </div>
      )}

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
              { key: "instagram", label: "Instagram" },
              { key: "facebook", label: "Facebook" },
              { key: "linkedin", label: "LinkedIn" },
            ] as const
          ).map((p) => {
            // Per-platform Post-button state. FB + IG depend on
            // Meta connection AND pages_manage_posts /
            // instagram_content_publish (still pending Meta review).
            // We render the button anyway and let the endpoint
            // surface the "pending scope" reason via toast.
            const connected =
              p.key === "linkedin" ? liConnected : metaConnected;
            const platformLabel =
              p.key === "linkedin" ? "LinkedIn" : p.key === "facebook" ? "Facebook" : "Instagram";
            const pendingScope = p.key === "facebook" || p.key === "instagram";
            return (
              <div
                key={p.key}
                className="rounded-md border border-border bg-surface-2/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {p.label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copy(drafts[p.key], p.key)}
                      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] hover:border-brand-500"
                    >
                      {copiedKey === p.key ? (
                        <Check className="h-3 w-3 text-emerald-600" strokeWidth={2} />
                      ) : (
                        <Copy className="h-3 w-3" strokeWidth={2} />
                      )}
                      {copiedKey === p.key ? "Copied" : "Copy"}
                    </button>
                    {connected === false ? (
                      <a
                        href={p.key === "linkedin" ? "/api/auth/linkedin" : "/api/auth/meta"}
                        className="inline-flex items-center gap-1 rounded border border-brand-500 bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                        title={`Connect ${platformLabel} to enable posting`}
                      >
                        Connect {platformLabel}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => postTo(p.key)}
                        disabled={postingPlatform !== null || connected === null}
                        title={
                          pendingScope
                            ? `${platformLabel} posting requires app-review scope (pending). Button works once approved.`
                            : `Publish to ${platformLabel}`
                        }
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                          pendingScope
                            ? "border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                            : "bg-brand-600 text-white hover:bg-brand-500"
                        } disabled:opacity-50`}
                      >
                        <Send className="h-3 w-3" strokeWidth={2} />
                        {postingPlatform === p.key
                          ? "Posting…"
                          : pendingScope
                            ? `Post (pending review)`
                            : `Post to ${platformLabel}`}
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={drafts[p.key]}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.key]: e.target.value }))
                  }
                  rows={4}
                  className="w-full resize-y rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed text-text focus:border-brand-500 focus:outline-none"
                />
              </div>
            );
          })}

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
