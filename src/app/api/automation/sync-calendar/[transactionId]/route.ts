/**
 * POST /api/automation/sync-calendar/:transactionId
 *
 * Push every milestone on the given transaction into the user's
 * private-ops Google Calendar as a 30-minute reminder event.
 * Idempotent — already-linked milestones are skipped.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { GoogleCalendarService } from "@/services/integrations/GoogleCalendarService";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ transactionId: string }> },
) {
  const { transactionId } = await ctx.params;

  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return NextResponse.json(
      { error: "GOOGLE_* env vars not configured" },
      { status: 500 },
    );
  }

  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { milestones: true, contact: true },
  });
  if (!txn) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }

  const account = await prisma.account.findUnique({
    where: { id: txn.accountId },
    select: { id: true, googleOauthTokensEncrypted: true, settingsJson: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    return NextResponse.json(
      {
        error: "Google not connected",
        connectUrl: `/api/auth/google?accountId=${txn.accountId}`,
      },
      { status: 412 },
    );
  }

  // Resolve primary + optional private-ops calendar from settings.
  // Default primary to "primary" alias if not explicitly set.
  const settings =
    account.settingsJson && typeof account.settingsJson === "object"
      ? (account.settingsJson as Record<string, unknown>)
      : {};
  const calCfg =
    settings.googleCalendar && typeof settings.googleCalendar === "object"
      ? (settings.googleCalendar as Record<string, unknown>)
      : {};
  const primaryCalendarId =
    (typeof calCfg.primaryCalendarId === "string" && calCfg.primaryCalendarId) ||
    "primary";
  const privateOpsCalendarId =
    typeof calCfg.privateOpsCalendarId === "string"
      ? calCfg.privateOpsCalendarId
      : undefined;

  // Onboarding wizard captures a share-list (TC, brokerage compliance,
  // co-agent emails). Every milestone event we create invites this list
  // so they get auto-added to the agent's deal calendar without manual
  // copy-paste. Empty list = events go on the agent's calendar only.
  const onboardingCfg =
    settings.onboarding && typeof settings.onboarding === "object"
      ? (settings.onboarding as Record<string, unknown>)
      : {};
  const shareList = Array.isArray(onboardingCfg.calendarShareList)
    ? (onboardingCfg.calendarShareList as unknown[]).filter(
        (e): e is string => typeof e === "string",
      )
    : [];

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

  const startedAt = Date.now();
  try {
    const auth = await oauth.createAuthenticatedClient(account.id);
    const cal = new GoogleCalendarService(
      auth,
      {
        primaryCalendarId,
        privateOpsCalendarId,
        defaultReminderDurationMinutes: 30,
      },
      prisma,
    );

    const result = await cal.syncTransactionMilestones(txn, { shareList });
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      result,
    });
  } catch (err) {
    console.error("Calendar sync failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "calendar sync failed",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
