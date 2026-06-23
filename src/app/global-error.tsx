"use client";

/**
 * Global error boundary — the last line of defense.
 *
 * Next.js renders this ONLY when the root layout itself throws (so the
 * normal error.tsx, which lives inside the layout, can't catch it). It
 * must therefore ship its own <html>/<body>. Kept dependency-free and
 * inline-styled so it can render even if app chrome / CSS failed to load.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0b0f17",
          color: "#e5e7eb",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            padding: 32,
            textAlign: "center",
            borderRadius: 12,
            border: "1px solid #1f2937",
            background: "#111827",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: 12, fontSize: 14, color: "#9ca3af" }}>
            We hit a temporary snag. Please try again in a moment.
          </p>
          <div
            style={{
              marginTop: 24,
              display: "flex",
              gap: 8,
              justifyContent: "center",
            }}
          >
            <button
              onClick={() => reset()}
              style={{
                cursor: "pointer",
                borderRadius: 6,
                border: "none",
                background: "#2563eb",
                color: "#fff",
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Try again
            </button>
            <a
              href="/login"
              style={{
                borderRadius: 6,
                border: "1px solid #374151",
                color: "#e5e7eb",
                padding: "10px 20px",
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Sign in
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
