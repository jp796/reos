/**
 * POST /api/push/test
 *
 * Sends a test notification to every active subscription owned by the
 * caller. Used by the Settings → Notifications panel "Send test"
 * button so users can verify their device is wired correctly.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import {
  isWebPushConfigured,
  sendToUser,
} from "@/services/integrations/WebPushService";

export const runtime = "nodejs";

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!isWebPushConfigured()) {
    return NextResponse.json(
      { error: "Web Push not configured on the server" },
      { status: 503 },
    );
  }

  const result = await sendToUser(actor.userId, {
    title: "REOS test push",
    body: "Notifications are working. You'll see your morning brief here too.",
    url: "/today",
    tag: "test",
  });

  return NextResponse.json({ ok: true, result });
}
