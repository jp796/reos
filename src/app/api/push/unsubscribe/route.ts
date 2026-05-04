/**
 * POST /api/push/unsubscribe
 * Body: { endpoint: string }
 *
 * Removes the row entirely. Browsers also call
 * `subscription.unsubscribe()` to release the OS-level grant; this
 * endpoint cleans up our DB-side mirror.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

const body = z.object({ endpoint: z.string().url() });

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  // Scope deletion to the caller — they can only remove their own
  // device subscriptions, never another user's.
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.endpoint, userId: actor.userId },
  });

  return NextResponse.json({ ok: true });
}
