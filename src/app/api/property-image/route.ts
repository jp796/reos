/**
 * GET /api/property-image?address=...&kind=streetview|satellite
 *
 * Proxies a property photo from Google Maps Platform — a Street View curb photo
 * or a satellite/aerial — so the API key stays server-side and is never exposed
 * to the browser. Returns 204 when no key is configured or no imagery exists, so
 * the <PropertyPhoto> component can hide gracefully. Session-gated so the key
 * can't be driven by anonymous traffic.
 */

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

const SIZE = "640x400";

export async function GET(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key) return new NextResponse(null, { status: 204 }); // feature not wired yet

  const address = req.nextUrl.searchParams.get("address")?.trim();
  if (!address) return new NextResponse(null, { status: 204 });
  const kind = req.nextUrl.searchParams.get("kind") === "satellite" ? "satellite" : "streetview";

  const loc = encodeURIComponent(address);
  const url =
    kind === "satellite"
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${loc}&zoom=19&size=${SIZE}&scale=2&maptype=satellite&markers=color:0x2563EB%7C${loc}&key=${key}`
      : `https://maps.googleapis.com/maps/api/streetview?size=${SIZE}&location=${loc}&source=outdoor&fov=80&return_error_code=true&key=${key}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    // Street View returns 404 (return_error_code) when there's no imagery for
    // the address — hide rather than show Google's "no imagery" placeholder.
    if (!res.ok) return new NextResponse(null, { status: 204 });
    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        // Cache hard — the same address returns the same image, and this avoids
        // re-billing Google for repeat views.
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
