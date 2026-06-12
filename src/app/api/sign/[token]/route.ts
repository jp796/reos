/**
 * Public signer view — GET /api/sign/[token]
 *
 * Token IS the credential (48-byte crypto-random, emailed to the
 * signer). No session. Generic 404 on any miss so tokens can't be
 * probed for information. Rate-limited per IP (scraper-guardrails).
 */
import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getSignerView } from "@/services/esign/NativeEsignService";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const ip = clientIp(req);
  const rl = rateLimit(`sign:view:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } },
    );
  }

  const { token } = await ctx.params;
  const view = await getSignerView(
    token,
    ip,
    req.headers.get("user-agent")?.slice(0, 300) ?? "",
  );
  if (!view) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(view);
}
