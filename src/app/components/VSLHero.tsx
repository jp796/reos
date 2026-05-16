"use client";

/**
 * VSLHero
 *
 * Video Sales Letter player tuned for the homepage. Designed around
 * what actually converts in 2026:
 *
 *   - autoplay-muted on scroll-into-view (Chrome / Safari / Firefox
 *     all allow muted autoplay, so the user sees the video moving
 *     and is invited to unmute)
 *   - tap-to-unmute overlay that disappears once audio is on
 *   - pause when scrolled out of view (saves bandwidth + battery)
 *   - time-gated CTA that fades in at `ctaRevealSeconds`
 *   - per-10s watch-progress tracking via window.fetch to
 *     /api/analytics/vsl (no-ops gracefully if the endpoint doesn't
 *     exist yet; the call just 404s, which is fine — front-end
 *     console-warns once)
 *
 * Expects a direct video URL (Cloudflare Stream / Mux / Vimeo Pro /
 * S3 — anything that returns an mp4 or HLS). For the placeholder
 * period before JP records the proper VSL, we render a poster
 * image + "Coming soon" overlay instead of a broken `<video>`.
 *
 * Future: when REOS has Cloudflare Stream wired we can also pull
 * HLS manifests + adaptive bitrate for free; for now `<video>` with
 * a single mp4 is fine.
 */

import { useEffect, useRef, useState } from "react";
import { Play, Volume2, VolumeX, ArrowRight } from "lucide-react";

export interface VSLHeroProps {
  /**
   * Direct video URL — mp4 preferred, HLS (.m3u8) also OK on Safari.
   * When null we render a placeholder card with the poster image
   * and a "Coming soon" message, so JP can ship the component
   * before the video itself exists.
   */
  videoUrl: string | null;

  /** Poster image (1280×720 or 1920×1080). Always shown before play. */
  posterUrl?: string;

  /** Headline above the player. */
  headline: string;

  /** Subheadline below the player, above the CTA. */
  subheadline?: string;

  /**
   * Seconds into the video at which the CTA fades in. Defaults to
   * 2:30 (150) — typical for a 4–6 minute VSL where the offer drops
   * at the midpoint and is reinforced at the end.
   */
  ctaRevealSeconds?: number;

  /** Text for the CTA button. */
  ctaLabel: string;

  /** URL the CTA links to. */
  ctaHref: string;
}

const PROGRESS_TICK_SECONDS = 10;

export function VSLHero({
  videoUrl,
  posterUrl,
  headline,
  subheadline,
  ctaRevealSeconds = 150,
  ctaLabel,
  ctaHref,
}: VSLHeroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);
  const lastReportedTickRef = useRef<number>(-1);

  // ── Autoplay on scroll-into-view, pause when out ────────────────
  useEffect(() => {
    const el = containerRef.current;
    const video = videoRef.current;
    if (!el || !video) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Browsers require muted=true for autoplay to be approved.
            video.muted = true;
            video.play().catch(() => {
              // Some browsers (older Safari) still reject — non-fatal.
            });
          } else {
            video.pause();
          }
        }
      },
      // Trigger when 40% of the player is in viewport — feels natural
      // and avoids firing for headers/nav.
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ── Time-gated CTA + progress tracking ──────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onTime() {
      if (!video) return;
      const t = video.currentTime;

      if (!ctaVisible && t >= ctaRevealSeconds) {
        setCtaVisible(true);
      }

      // Tick every PROGRESS_TICK_SECONDS — fire-and-forget POST.
      const currentTick = Math.floor(t / PROGRESS_TICK_SECONDS);
      if (currentTick !== lastReportedTickRef.current) {
        lastReportedTickRef.current = currentTick;
        // The endpoint may not exist yet — that's fine. We don't
        // wait, don't retry, and warn at most once per page load.
        fetch("/api/analytics/vsl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            t: Math.round(t),
            duration: video.duration,
            event: "progress",
          }),
        }).catch(() => {
          /* silent */
        });
      }
    }
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [ctaRevealSeconds, ctaVisible]);

  // ── Manual play (poster click) ─────────────────────────────────
  function manualPlay() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setMuted(false);
    video.play().catch(() => {});
    setPlaying(true);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  return (
    <section
      ref={containerRef}
      className="mx-auto w-full max-w-5xl px-4 py-12 text-center"
    >
      <h2 className="font-display text-3xl font-bold tracking-tight text-text sm:text-5xl">
        {headline}
      </h2>

      <div className="relative mx-auto mt-8 aspect-video w-full overflow-hidden rounded-xl border border-border bg-black shadow-2xl">
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              src={videoUrl}
              poster={posterUrl}
              playsInline
              muted
              loop={false}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />

            {/* Tap-to-unmute overlay — visible until the user clicks. */}
            {muted && playing && (
              <button
                type="button"
                onClick={toggleMute}
                className="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/40"
                aria-label="Unmute video"
              >
                <span className="flex items-center gap-3 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black shadow-lg">
                  <VolumeX className="h-4 w-4" strokeWidth={2} />
                  Tap to unmute
                </span>
              </button>
            )}

            {/* Initial-play overlay — visible before any play attempt. */}
            {!playing && (
              <button
                type="button"
                onClick={manualPlay}
                className="absolute inset-0 flex items-center justify-center bg-black/40 transition hover:bg-black/50"
                aria-label="Play video"
              >
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-2xl">
                  <Play className="ml-1 h-9 w-9 text-black" strokeWidth={2.5} />
                </span>
              </button>
            )}

            {/* Mute toggle (small, bottom-right) — always available
                once playing has begun. */}
            {playing && (
              <button
                type="button"
                onClick={toggleMute}
                className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? (
                  <VolumeX className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <Volume2 className="h-4 w-4" strokeWidth={2} />
                )}
              </button>
            )}
          </>
        ) : (
          // Placeholder before JP records the proper VSL. Looks
          // like a video player but stays static — better than a
          // broken <video> tag that flashes to a black square.
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              backgroundImage: posterUrl ? `url(${posterUrl})` : undefined,
              backgroundColor: "#050E3D", // Real Broker Cobalt fallback
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className="rounded-xl bg-black/50 px-8 py-6 text-center backdrop-blur">
              <span className="block text-xs font-semibold uppercase tracking-wider text-aqua-300">
                Coming soon
              </span>
              <span className="mt-2 block text-2xl font-display font-bold text-white sm:text-3xl">
                Full product walkthrough
              </span>
              <span className="mt-1 block text-sm text-white/70">
                90-second tour available below in the meantime.
              </span>
            </div>
          </div>
        )}
      </div>

      {subheadline && (
        <p className="mx-auto mt-6 max-w-2xl text-base text-text-muted sm:text-lg">
          {subheadline}
        </p>
      )}

      {/* Time-gated CTA — fades in once the watcher hits
          ctaRevealSeconds. Stays put once revealed. */}
      <div
        className="mt-6 transition-opacity duration-700"
        style={{ opacity: ctaVisible || videoUrl === null ? 1 : 0 }}
      >
        <a
          href={ctaHref}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-6 py-3 text-base font-bold text-white shadow-lg hover:bg-brand-500"
        >
          {ctaLabel}
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </a>
      </div>
    </section>
  );
}
