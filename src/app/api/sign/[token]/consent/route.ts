/**
 * ESIGN consent — POST /api/sign/[token]/consent
 * Records the signer's affirmative consent to electronic records
 * and signatures (timestamp + IP + user-agent + consent text version).
 */
import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { recordConsent } from "@/services/esign/NativeEsignService";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const ip = clientIp(req);
  const rl = rateLimit(`sign:consent:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } },
    );
  }

  const { token } = await ctx.params;
  const result = await recordConsent(
    token,
    ip,
    req.headers.get("user-agent")?.slice(0, 300) ?? "",
  );
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
