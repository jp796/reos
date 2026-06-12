/**
 * Public signer page image — GET /api/sign/[token]/page/[n]
 * Streams one rendered PDF page as PNG. Token-checked, rate-limited.
 */
import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getSignerPagePng } from "@/services/esign/NativeEsignService";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; n: string }> },
) {
  const ip = clientIp(req);
  const rl = rateLimit(`sign:page:${ip}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } },
    );
  }

  const { token, n } = await ctx.params;
  const page = Number.parseInt(n, 10);
  if (!Number.isInteger(page) || page < 1 || page > 500) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const png = await getSignerPagePng(token, page);
  if (!png) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // Private: signed-document pages must never land in shared caches.
      "Cache-Control": "private, max-age=300",
    },
  });
}
