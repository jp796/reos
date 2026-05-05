"use client";

/**
 * REOS logomark + wordmark.
 *
 * Pure SVG so it renders crisp at any size and respects the
 * theme tokens (uses currentColor for the navy "R E S" letters
 * and a literal gradient for the "O" — gradient hue is fixed by
 * brand guide and shouldn't shift with light/dark).
 *
 * Usage:
 *   <Logo size={32} />              // mark only (default)
 *   <Logo size={32} showWordmark /> // mark + REOS wordmark
 */

import { useId } from "react";

interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

export function Logo({ size = 32, showWordmark = false, className }: LogoProps) {
  // Use React's useId so the gradient ID matches between server-render
  // and client-hydration. Math.random() here was producing different
  // IDs on each side of the hydration boundary, throwing a runtime
  // exception ("Application error: a client-side exception has
  // occurred") on every page that renders <Logo>.
  const rawId = useId();
  const gradId = `reos-logo-grad${rawId.replace(/:/g, "_")}`;
  return (
    <span
      className={"inline-flex items-center gap-2 " + (className ?? "")}
      style={{ lineHeight: 1 }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="REOS"
        role="img"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        {/* Roof — single-stroke house silhouette with a small chimney
            window. Uses currentColor so it picks up the surrounding
            text color (navy in light, near-white in dark). */}
        <path
          d="M10 28 L32 8 L54 28"
          fill="none"
          stroke="currentColor"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="29"
          y="16"
          width="6"
          height="6"
          fill="currentColor"
          rx="0.5"
        />
        {/* O ring with the three-bar logo glyph in the middle —
            the gradient mark. */}
        <circle
          cx="32"
          cy="42"
          r="14"
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="4"
        />
        <rect x="26" y="36" width="12" height="2" fill={`url(#${gradId})`} />
        <rect x="26" y="41" width="12" height="2" fill={`url(#${gradId})`} />
        <rect x="26" y="46" width="12" height="2" fill={`url(#${gradId})`} />
      </svg>
      {showWordmark && (
        <span className="font-display text-base font-bold tracking-tight">
          <span style={{ color: "currentColor" }}>RE</span>
          <span className="text-gradient-brand">OS</span>
        </span>
      )}
    </span>
  );
}
