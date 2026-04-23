/**
 * POST /api/transactions/:id/calendar/cleanup-orphans
 *
 * Cancel every Google Calendar event this transaction still holds
 * that points at a milestone which no longer exists in the DB.
 *
 * Use case: you deleted a bunch of template-seeded milestones (the
 * old "appraisal_ordered / inspections_scheduled" hallucinations)
 * and want the corresponding Calendar entries to disappear too.
 *
 * Safe + idempotent. Uses events.patch → {status: "cancelled"}
 * (events.delete is blocked by calendar-guard).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { google } from "googleapis";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { requireSession, assertSameAccount } from "@/lib/require-session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return NextResponse.json(
      { error: "Google OAuth env not configured" },
      { status: 500 },
    );
  }

  const msIds = new Set(
    (
      await prisma.milestone.findMany({
        where: { transactionId: id },
        select: { id: true },
      })
    ).map((m) => m.id),
  );

  const events = await prisma.calendarEvent.findMany({
    where: {
      transactionId: id,
      source: "milestone_auto",
      status: "active",
    },
  });

  // Orphans:
  //   (a) linked to a milestone that no longer exists, OR
  //   (b) linked to a milestone whose dueAt is now null (undated)
  // For (b) we re-check the current dueAt rather than the stale row,
  // since an edit to null should retract the calendar entry too.
  const liveMsDates = await prisma.milestone.findMany({
    where: { id: { in: [...msIds] } },
    select: { id: true, dueAt: true },
  });
  const undatedMsIds = new Set(
    liveMsDates.filter((m) => !m.dueAt).map((m) => m.id),
  );

  const orphans = events.filter((e) => {
    if (!e.milestoneId) return false;
    if (!msIds.has(e.milestoneId)) return true; // deleted
    if (undatedMsIds.has(e.milestoneId)) return true; // undated
    return false;
  });

  if (orphans.length === 0) {
    return NextResponse.json({ ok: true, cancelled: 0, orphans: 0 });
  }

  const acct = await prisma.account.findUnique({
    where: { id: txn.accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!acct?.googleOauthTokensEncrypted) {
    return NextResponse.json({ error: "Google not connected" }, { status: 400 });
  }

  const oauth = new GoogleOAuthService(
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
      scopes: DEFAULT_SCOPES,
    },
    prisma,
    getEncryptionService(),
  );
  const gAuth = await oauth.createAuthenticatedClient(txn.accountId);
  const cal = google.calendar({ version: "v3", auth: gAuth });

  let cancelled = 0;
  const errors: Array<{ eventId: string; error: string }> = [];
  for (const o of orphans) {
    try {
      if (o.googleEventId) {
        await cal.events.patch({
          calendarId: "primary",
          eventId: o.googleEventId,
          requestBody: { status: "cancelled" },
        });
      }
      await prisma.calendarEvent.update({
        where: { id: o.id },
        data: { status: "cancelled" },
      });
      cancelled++;
    } catch (err) {
      errors.push({
        eventId: o.googleEventId ?? o.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    orphans: orphans.length,
    cancelled,
    errors,
  });
}
