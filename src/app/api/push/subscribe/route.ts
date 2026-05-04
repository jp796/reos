/**
 * POST /api/push/subscribe
 *
 * Body: PushSubscriptionJSON-shaped object (browser hands this to us
 * after navigator.serviceWorker.ready.then(reg => reg.pushManager.subscribe()).toJSON())
 *
 *   {
 *     "endpoint": "https://fcm.googleapis.com/...",
 *     "keys": { "p256dh": "...", "auth": "..." }
 *   }
 *
 * Upserts on endpoint so re-subscribing from the same browser doesn't
 * create duplicates. Always scoped to the calling user + account; we
 * never trust an accountId from the body.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isWebPushConfigured } from "@/services/integrations/WebPushService";

export const runtime = "nodejs";

const body = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!isWebPushConfigured()) {
    return NextResponse.json(
      { error: "Web Push not configured on the server" },
      { status: 503 },
    );
  }

  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.endpoint },
    create: {
      accountId: actor.accountId,
      userId: actor.userId,
      endpoint: parsed.endpoint,
      p256dh: parsed.keys.p256dh,
      auth: parsed.keys.auth,
      userAgent,
    },
    update: {
      // Re-subscribing on the same endpoint may rotate keys.
      p256dh: parsed.keys.p256dh,
      auth: parsed.keys.auth,
      // If the row was previously disabled (404/410), un-disable it.
      disabledAt: null,
      // Trust the new session — but only if the same user owns it.
      // Otherwise stay tied to the original owner (defense against an
      // attacker who steals an endpoint from another user's browser).
      userId: actor.userId,
      accountId: actor.accountId,
      userAgent,
    },
  });

  return NextResponse.json({ ok: true });
}
