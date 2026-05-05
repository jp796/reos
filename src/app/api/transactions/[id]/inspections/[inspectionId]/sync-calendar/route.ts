/**
 * POST /api/transactions/:id/inspections/:inspectionId/sync-calendar
 *
 * Pushes the scheduled inspection appointment to Google Calendar as
 * a 90-minute event on the agent's primary calendar. Idempotent —
 * if a calendarEventId is already linked, returns ok without
 * creating a dupe.
 *
 * Attendees include the account's onboarding share-list so the TC
 * + brokerage compliance get auto-invited (same pattern as
 * milestone calendar sync).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { GoogleCalendarService } from "@/services/integrations/GoogleCalendarService";
import { getEncryptionService } from "@/lib/encryption";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; inspectionId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id, inspectionId } = await ctx.params;

  const inspection = await prisma.transactionInspection.findUnique({
    where: { id: inspectionId },
    include: {
      transaction: {
        select: {
          id: true,
          accountId: true,
          propertyAddress: true,
          city: true,
          state: true,
          zip: true,
        },
      },
    },
  });
  if (!inspection) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (inspection.transactionId !== id) {
    return NextResponse.json({ error: "mismatch" }, { status: 400 });
  }
  if (inspection.transaction.accountId !== actor.accountId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!inspection.scheduledAt) {
    return NextResponse.json(
      { error: "set a date/time before syncing" },
      { status: 400 },
    );
  }
  if (inspection.calendarEventId) {
    return NextResponse.json({
      ok: true,
      alreadyLinked: true,
      calendarEventId: inspection.calendarEventId,
    });
  }

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { googleOauthTokensEncrypted: true, settingsJson: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    return NextResponse.json(
      {
        error: "Google not connected",
        connectUrl: `/api/auth/google?accountId=${actor.accountId}`,
      },
      { status: 412 },
    );
  }

  const settings = (account.settingsJson ?? {}) as Record<string, unknown>;
  const onboarding = (settings.onboarding ?? {}) as Record<string, unknown>;
  const shareList = Array.isArray(onboarding.calendarShareList)
    ? (onboarding.calendarShareList as unknown[]).filter(
        (e): e is string => typeof e === "string",
      )
    : [];
  const calCfg = (settings.googleCalendar ?? {}) as Record<string, unknown>;
  const primaryCalendarId =
    (typeof calCfg.primaryCalendarId === "string" &&
      calCfg.primaryCalendarId) ||
    "primary";

  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return NextResponse.json(
      { error: "Google not configured on server" },
      { status: 500 },
    );
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

  try {
    const auth = await oauth.createAuthenticatedClient(actor.accountId);
    const cal = new GoogleCalendarService(
      auth,
      { primaryCalendarId, defaultReminderDurationMinutes: 90 },
      prisma,
    );

    const startAt = inspection.scheduledAt;
    const endAt = new Date(startAt.getTime() + 90 * 60 * 1000);
    const propAddress = inspection.transaction.propertyAddress ?? "Property";
    const city = [
      inspection.transaction.city,
      inspection.transaction.state,
      inspection.transaction.zip,
    ]
      .filter(Boolean)
      .join(" ");

    const attendees = shareList
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      .filter((e, i, a) => a.indexOf(e) === i)
      .map((email) => ({ email }));

    const { localEvent } = await cal.createEvent({
      accountId: actor.accountId,
      transactionId: inspection.transactionId,
      calendarType: "external",
      title: `[REOS] ${inspection.label} · ${propAddress}`,
      startAt,
      endAt,
      location: city || propAddress,
      description: [
        `Inspection on ${propAddress}`,
        inspection.vendorName ? `Vendor: ${inspection.vendorName}` : null,
        inspection.vendorNote ? `Notes: ${inspection.vendorNote}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      attendees: attendees.length > 0 ? attendees : undefined,
      source: "manual",
      visibility: "default",
    });

    await prisma.transactionInspection.update({
      where: { id: inspection.id },
      data: { calendarEventId: localEvent.id },
    });

    return NextResponse.json({ ok: true, calendarEventId: localEvent.id });
  } catch (e) {
    logError(e, {
      route: "inspection sync-calendar",
      accountId: actor.accountId,
      transactionId: id,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "sync failed" },
      { status: 500 },
    );
  }
}
