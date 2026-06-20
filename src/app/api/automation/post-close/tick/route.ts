/**
 * POST /api/automation/post-close/tick
 *
 * Run the post-close automation sweep — creates follow-up tasks for
 * every closed transaction whose elapsed time crosses a rule threshold.
 * Idempotent (audit-log dedupe per rule per transaction).
 *
 * Callable by an authed user on-demand OR by Cloud Scheduler via OIDC
 * (we exempt webhook-style automation endpoints from session gating
 * only when SCAN_SCHEDULE_SECRET is present as a header; otherwise the
 * middleware's session gate applies normally).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { tickPostClose } from "@/services/automation/PostCloseAutomation";
import { processScheduledEmails } from "@/services/automation/ScheduledEmailService";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Allow a shared-secret header for automated invocation (Cloud
  // Scheduler, local cron). If the secret matches, bypass session.
  const secret = req.headers.get("x-reos-scan-secret");
  const secretOk =
    !!env.SCAN_SCHEDULE_SECRET && secret === env.SCAN_SCHEDULE_SECRET;

  if (!secretOk) {
    const actor = await requireSession();
    if (actor instanceof NextResponse) return actor;
  }

  const result = await tickPostClose(prisma);
  // Piggyback the scheduled-email sweep on the hourly tick (no new cron).
  let scheduledEmails = { claimed: 0, sent: 0, failed: 0 };
  try {
    scheduledEmails = await processScheduledEmails(prisma);
  } catch {
    /* never let the email sweep break the post-close tick */
  }
  return NextResponse.json({ ok: true, ...result, scheduledEmails });
}
