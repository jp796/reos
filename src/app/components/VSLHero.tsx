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
 *   - per-10s watch-progress tracking to /api/analytics/vsl
 *
 * Supports two backends:
 *   - `youtubeId` — YouTube Unlisted upload (free, no infra cost,
 *     adaptive bitrate, CDN-distributed, but UI-restricted to what
 *     the iframe API exposes). Used by REOS as of 2026-06-11.
 *   - `videoUrl` — direct mp4 / HLS URL (Cloudflare Stream, Mux,
 *     S3, etc.). Use this when YouTube cosmetics don't fit and
 *     paying for a self-host makes sense.
 *
 * When both are null we render a placeholder card so the component
 * can ship before the video exists.
 */

import { useEffect, useRef, useState } from "react";
import { Play, Volume2, VolumeX, ArrowRight } from "lucide-react";

export interface VSLHeroProps {
  /**
   * Direct video URL — mp4 preferred, HLS (.m3u8) also OK on Safari.
   * Mutually exclusive with `youtubeId` — if both are set, the YT
   * embed wins.
   */
  videoUrl: string | null;

  /**
   * YouTube video id (the part after `?v=` or `youtu.be/`). The
   * video must be Public or Unlisted; Private videos won't play in
   * the embed. Wins over `videoUrl` when both are set.
   */
  youtubeId?: string | null;

  /** Poster image (1280×720 or 1920×1080). Used by the placeholder. */
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

// ── YouTube IFrame Player API — minimal typings ──────────────────
interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
}
interface YTPlayerEvent {
  data: number;
  target: YTPlayer;
}
interface YTGlobal {
  Player: new (
    el: HTMLElement | string,
    config: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Singleton loader — multiple VSLHero mounts share one script tag.
let ytApiLoadPromise: Promise<YTGlobal> | null = null;
function loadYouTubeApi(): Promise<YTGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("ssr"));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiLoadPromise) return ytApiLoadPromise;
  ytApiLoadPromise = new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) resolve(window.YT);
    };
  });
  return ytApiLoadPromise;
}

const PROGRESS_TICK_SECONDS = 10;
const YT_POLL_MS = 500;

export function VSLHero({
  videoUrl,
  youtubeId,
  posterUrl,
  headline,
  subheadline,
  ctaRevealSeconds = 150,
  ctaLabel,
  ctaHref,
}: VSLHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytMountRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const [ytReady, setYtReady] = useState(false);

  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);
  const lastReportedTickRef = useRef<number>(-1);

  const useYouTube = !!youtubeId;
  const useNativeVideo = !useYouTube && !!videoUrl;
  const showPlaceholder = !useYouTube && !useNativeVideo;

  // ── YouTube player init ─────────────────────────────────────────
  useEffect(() => {
    if (!useYouTube || !ytMountRef.current || !youtubeId) return;
    let canceled = false;
    let player: YTPlayer | null = null;

    loadYouTubeApi()
      .then((YT) => {
        if (canceled || !ytMountRef.current) return;
        player = new YT.Player(ytMountRef.current, {
          videoId: youtubeId,
          width: "100%",
          height: "100%",
          playerVars: {
            // We trigger play from the IntersectionObserver, not autoplay,
            // so we can control the muted-vs-unmuted state on first play.
            autoplay: 0,
            mute: 1,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3, // suppress annotations
            disablekb: 1,
            fs: 0,
          },
          events: {
            onReady: ({ target }) => {
              ytPlayerRef.current = target;
              setYtReady(true);
            },
            onStateChange: ({ data }) => {
              // 1 = playing, 2 = paused, 0 = ended, 3 = buffering
              if (data === 1) setPlaying(true);
              else if (data === 2 || data === 0) setPlaying(false);
            },
          },
        });
      })
      .catch(() => {
        // Script failed to load (ad-blocker, network) — placeholder is
        // already not shown for the YT path, so we just stay quiet.
      });

    return () => {
      canceled = true;
      try {
        player?.destroy();
      } catch {
        /* noop */
      }
      ytPlayerRef.current = null;
      setYtReady(false);
    };
  }, [useYouTube, youtubeId]);

  // ── Autoplay on scroll-into-view, pause when out ────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (useYouTube) {
              const p = ytPlayerRef.current;
              if (p) {
                try {
                  p.mute();
                  p.playVideo();
                } catch {
                  /* noop */
                }
              }
            } else if (useNativeVideo) {
              const v = videoRef.current;
              if (v) {
                v.muted = true;
                v.play().catch(() => {});
              }
            }
          } else {
            if (useYouTube) {
              try {
                ytPlayerRef.current?.pauseVideo();
              } catch {
                /* noop */
              }
            } else if (useNativeVideo) {
              videoRef.current?.pause();
            }
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [useYouTube, useNativeVideo, ytReady]);

  // ── YouTube polling: CTA reveal + analytics beacon ──────────────
  useEffect(() => {
    if (!useYouTube || !ytReady) return;
    const id = window.setInterval(() => {
      const p = ytPlayerRef.current;
      if (!p) return;
      let t = 0;
      let duration = 0;
      try {
        t = p.getCurrentTime() ?? 0;
        duration = p.getDuration() ?? 0;
      } catch {
        return;
      }
      if (!ctaVisible && t >= ctaRevealSeconds) {
        setCtaVisible(true);
      }
      const tick = Math.floor(t / PROGRESS_TICK_SECONDS);
      if (tick !== lastReportedTickRef.current && tick >= 0 && t > 0) {
        lastReportedTickRef.current = tick;
        fetch("/api/analytics/vsl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            t: Math.round(t),
            duration,
            event: "progress",
          }),
        }).catch(() => {});
      }
    }, YT_POLL_MS);
    return () => window.clearInterval(id);
  }, [useYouTube, ytReady, ctaRevealSeconds, ctaVisible]);

  // ── Native <video> time-gated CTA + progress ────────────────────
  useEffect(() => {
    if (!useNativeVideo) return;
    const video = videoRef.current;
    if (!video) return;

    function onTime() {
      if (!video) return;
      const t = video.currentTime;
      if (!ctaVisible && t >= ctaRevealSeconds) {
        setCtaVisible(true);
      }
      const tick = Math.floor(t / PROGRESS_TICK_SECONDS);
      if (tick !== lastReportedTickRef.current) {
        lastReportedTickRef.current = tick;
        fetch("/api/analytics/vsl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            t: Math.round(t),
            duration: video.duration,
            event: "progress",
          }),
        }).catch(() => {});
      }
    }
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [useNativeVideo, ctaRevealSeconds, ctaVisible]);

  // ── Click-to-play (from the big poster overlay) ────────────────
  function manualPlay() {
    if (useYouTube) {
      const p = ytPlayerRef.current;
      if (!p) return;
      try {
        p.unMute();
        setMuted(false);
        p.playVideo();
        setPlaying(true);
      } catch {
        /* noop */
      }
    } else if (useNativeVideo) {
      const video = videoRef.current;
      if (!video) return;
      video.muted = false;
      setMuted(false);
      video.play().catch(() => {});
      setPlaying(true);
    }
  }

  function toggleMute() {
    if (useYouTube) {
      const p = ytPlayerRef.current;
      if (!p) return;
      try {
        if (p.isMuted()) {
          p.unMute();
          setMuted(false);
        } else {
          p.mute();
          setMuted(true);
        }
      } catch {
        /* noop */
      }
    } else if (useNativeVideo) {
      const video = videoRef.current;
      if (!video) return;
      video.muted = !video.muted;
      setMuted(video.muted);
    }
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
        {useYouTube && (
          <>
            {/* The YouTube IFrame Player API replaces this div with an
                iframe on instantiation. */}
            <div ref={ytMountRef} className="absolute inset-0 h-full w-full" />

            {/* Tap-to-unmute overlay — visible while muted+playing. The
                inner button consumes the click; the rest of the overlay
                is pointer-events:none so the user can interact with the
                video chrome below if YT ever re-injects controls. */}
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
        )}

        {useNativeVideo && (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              src={videoUrl ?? undefined}
              poster={posterUrl}
              playsInline
              muted
              loop={false}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />

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
        )}

        {showPlaceholder && (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              backgroundImage: posterUrl ? `url(${posterUrl})` : undefined,
              backgroundColor: "#050E3D",
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
          ctaRevealSeconds. Stays put once revealed. Placeholder
          mode shows the CTA immediately. */}
      <div
        className="mt-6 transition-opacity duration-700"
        style={{ opacity: ctaVisible || showPlaceholder ? 1 : 0 }}
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
