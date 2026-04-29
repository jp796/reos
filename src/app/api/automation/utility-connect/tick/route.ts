/**
 * POST /api/automation/utility-connect/tick
 *
 * Scheduler-friendly endpoint. Enrolls every buyer-side transaction
 * closing in 7-10 days into Utility Connect. Idempotent.
 *
 * Auth gate: same pattern as the post-close tick — same-origin from
 * an authed session, OR Bearer SCAN_SCHEDULE_SECRET for Cloud
 * Scheduler / external triggers.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { tickUtilityConnect } from "@/services/automation/UtilityConnectEnrollment";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    const result = await tickUtilityConnect(prisma);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    logError(e, { route: "/api/automation/utility-connect/tick" });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tick failed" },
      { status: 500 },
    );
  }
}
