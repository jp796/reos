"use client";

/**
 * Root error boundary for the App Router.
 *
 * Catches any uncaught error thrown while rendering a route segment
 * (server or client) and shows a calm recovery card instead of Next.js's
 * raw "Application error: a client-side exception has occurred" screen.
 *
 * The most common trigger in practice is a cold-database blip (Neon
 * autosuspend) on the first request from an infrequent user. `reset()`
 * re-renders the segment — by then the DB is awake and the retry in
 * src/lib/db.ts has it covered — so "Try again" almost always works on
 * the first click. We also surface a Sign in link so a user who lands
 * here mid-session always has a way back in.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console + any attached monitoring.
    console.error("Route error boundary:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-bg px-4 text-text">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="font-display text-xl font-bold">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm text-text-muted">
          We hit a temporary snag loading this page — usually the database
          waking up after a quiet stretch. Give it a second and try again.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
          >
            Try again
          </button>
          <Link
            href="/today"
            className="inline-flex items-center justify-center rounded-md border border-border bg-bg px-5 py-2.5 text-sm font-medium text-text hover:border-brand-500"
          >
            Go to dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md border border-border bg-bg px-5 py-2.5 text-sm font-medium text-text hover:border-brand-500"
          >
            Sign in
          </Link>
        </div>
        {error?.digest ? (
          <p className="mt-5 text-xs text-text-muted/70">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
