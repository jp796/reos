/**
 * POST /api/analytics/vsl
 *
 * Records VSL watch-progress events for the homepage video. Called
 * from VSLHero every PROGRESS_TICK_SECONDS (10s) with the current
 * playback position. Public — no auth required (the homepage is
 * public; tracking anonymous visitors is the whole point of a VSL
 * funnel).
 *
 * Body: { t: <seconds>, duration: <seconds>, event: "progress" | "play"
 *         | "pause" | "ended" }
 *
 * Storage: AutomationAuditLog with entityType "vsl_progress" so we
 * can roll up watch curves without standing up a separate analytics
 * table. accountId is null (no session) but kept as a field so the
 * insert succeeds — see SYSTEM_ACCOUNT below.
 *
 * Rate-limited softly: we drop events where t hasn't changed since
 * the last write from this IP+session (handled client-side by the
 * tick logic; the server is lenient). Drop-off curves are what we
 * want, not exact replay timelines.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;
const VALID_EVENTS = new Set(["progress", "play", "pause", "ended"]);

export async function POST(req: NextRequest) {
  // Cheap body-size guard — these events are tiny, > 4 KB is a
  // misuse attempt.
  const contentLength = parseInt(
    req.headers.get("content-length") ?? "0",
    10,
  );
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }

  let body: { t?: number; duration?: number; event?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Malformed JSON — silently 204. We don't want broken clients to
    // generate log noise on a public analytics endpoint.
    return new NextResponse(null, { status: 204 });
  }

  const event = (body.event ?? "progress").trim();
  if (!VALID_EVENTS.has(event)) {
    return new NextResponse(null, { status: 204 });
  }
  const t = Math.round(Number(body.t ?? 0));
  const duration = Math.round(Number(body.duration ?? 0));
  if (!Number.isFinite(t) || t < 0 || t > 24 * 3600) {
    return new NextResponse(null, { status: 204 });
  }

  // We need SOME accountId for the audit log row — the FK is non-null.
  // Pull the first account in the DB as the "system" tenant for
  // anonymous analytics. Done once at startup wouldn't help under
  // multi-tenant scale; for now this is the cheapest dependency.
  // TODO: when REOS has > 100 customers, move VSL analytics to a
  // dedicated table without an accountId FK.
  const systemAccount = await prisma.account.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!systemAccount) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: systemAccount.id,
        entityType: "vsl_progress",
        entityId: null,
        ruleName: "homepage_vsl",
        actionType: event,
        sourceType: "public",
        confidenceScore: 1.0,
        decision: "recorded",
        beforeJson: Prisma.JsonNull,
        afterJson: {
          t,
          duration,
          ua: req.headers.get("user-agent")?.slice(0, 200) ?? null,
          referer: req.headers.get("referer")?.slice(0, 200) ?? null,
          ip:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        },
      },
    });
  } catch {
    // Silent — analytics never blocks user experience.
  }
  return new NextResponse(null, { status: 204 });
}
