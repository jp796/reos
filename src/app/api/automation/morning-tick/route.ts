/**
 * POST /api/automation/morning-tick
 *
 * Atlas's daily 8am brief. Auth gate matches the other scheduled
 * endpoints — same-origin authed session, OR Bearer
 * SCAN_SCHEDULE_SECRET for Cloud Scheduler.
 *
 * Returns the structured tick result (also delivered to Telegram).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { runMorningTick } from "@/services/automation/MorningTick";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const scheduledOk =
    !!env.SCAN_SCHEDULE_SECRET && bearer === env.SCAN_SCHEDULE_SECRET;

  if (!scheduledOk) {
    const actor = await requireSession();
    if (actor instanceof NextResponse) return actor;
  }

  try {
    const result = await runMorningTick(prisma);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    logError(e, { route: "/api/automation/morning-tick" });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tick failed" },
      { status: 500 },
    );
  }
}
