/**
 * Sign completion — POST /api/sign/[token]/complete
 * Accepts the signature image + any text-field values, marks the
 * recipient signed, and finalizes the document when everyone has.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { completeSigning } from "@/services/esign/NativeEsignService";

export const runtime = "nodejs";
// Finalize (pdf render + gmail attachment) can exceed the default.
export const maxDuration = 60;

const bodySchema = z.object({
  signatureImage: z.string().min(50).max(400_000),
  values: z.record(z.string().max(500)).default({}),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const ip = clientIp(req);
  const rl = rateLimit(`sign:complete:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterS) } },
    );
  }

  const { token } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const result = await completeSigning(
    token,
    body.data,
    ip,
    req.headers.get("user-agent")?.slice(0, 300) ?? "",
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, completed: result.completed });
}
