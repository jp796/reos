"use client";

/**
 * PropertyPhoto — a property image pulled from Google (Street View curb photo or
 * satellite) via the /api/property-image proxy. Auto-loads from the address and
 * hides itself when there's no key configured or no imagery for the address, so
 * it's safe to drop anywhere an address is known.
 */

import { useState, useEffect } from "react";

export function PropertyPhoto({
  address,
  kind = "streetview",
  className = "",
  rounded = "rounded-xl",
}: {
  address: string | null | undefined;
  kind?: "streetview" | "satellite";
  className?: string;
  rounded?: string;
}) {
  const [status, setStatus] = useState<"loading" | "ok" | "none">("loading");
  const trimmed = address?.trim() ?? "";

  // Reset when the address changes so the same component can follow an edited field.
  useEffect(() => {
    setStatus(trimmed ? "loading" : "none");
  }, [trimmed, kind]);

  if (!trimmed || status === "none") return null;

  const src = `/api/property-image?address=${encodeURIComponent(trimmed)}&kind=${kind}`;
  return (
    <div className={`relative overflow-hidden ${rounded} bg-surface-2 ${className}`}>
      {status === "loading" && <div className="absolute inset-0 animate-pulse bg-surface-2" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`${kind === "satellite" ? "Aerial" : "Street view"} of ${trimmed}`}
        loading="lazy"
        onLoad={() => setStatus("ok")}
        onError={() => setStatus("none")}
        className={`h-full w-full object-cover transition-opacity duration-300 ${status === "ok" ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
