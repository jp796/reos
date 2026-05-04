"use client";

/**
 * PwaRegister — registers /sw.js once per browser session.
 *
 * Idempotent — calling navigator.serviceWorker.register() with the
 * same URL is cheap; the browser de-dupes. We only call it in
 * production builds because Next dev uses HMR + the SW would cache
 * stale chunks.
 *
 * Push subscription is opt-in via the Settings → Notifications
 * panel; this file only handles the SW lifecycle.
 */

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[PWA] SW registration failed:", err);
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
