/**
 * syncDealCalendar — push a deal's milestones into the account's Google
 * Calendar. Shared core extracted from the sync-calendar route so both
 * the route and the Atlas `sync_calendar` tool drive identical behavior.
 *
 * Returns { connected:false } when Google isn't linked (caller messages
 * the user), else the MilestoneSyncResult.
 */

import type { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { GoogleOAuthService, DEFAULT_SCOPES } from "@/services/integrations/GoogleOAuthService";
import { GoogleCalendarService } from "@/services/integrations/GoogleCalendarService";

export async function syncDealCalendar(
  db: PrismaClient,
  accountId: string,
  transactionId: string,
): Promise<
  | { connected: false }
  | { connected: true; created: number; alreadyLinked: number; attempted: number; errors: number }
> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return { connected: false };
  }
  const txn = await db.transaction.findUnique({
    where: { id: transactionId },
    include: { milestones: true, contact: true },
  });
  if (!txn) return { connected: true, created: 0, alreadyLinked: 0, attempted: 0, errors: 0 };

  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { id: true, googleOauthTokensEncrypted: true, settingsJson: true },
  });
  if (!account?.googleOauthTokensEncrypted) return { connected: false };

  const settings =
    account.settingsJson && typeof account.settingsJson === "object"
      ? (account.settingsJson as Record<string, unknown>)
      : {};
  const calCfg =
    settings.googleCalendar && typeof settings.googleCalendar === "object"
      ? (settings.googleCalendar as Record<string, unknown>)
      : {};
  const primaryCalendarId =
    (typeof calCfg.primaryCalendarId === "string" && calCfg.primaryCalendarId) || "primary";
  const privateOpsCalendarId =
    typeof calCfg.privateOpsCalendarId === "string" ? calCfg.privateOpsCalendarId : undefined;
  const onboardingCfg =
    settings.onboarding && typeof settings.onboarding === "object"
      ? (settings.onboarding as Record<string, unknown>)
      : {};
  const shareList = Array.isArray(onboardingCfg.calendarShareList)
    ? (onboardingCfg.calendarShareList as unknown[]).filter((e): e is string => typeof e === "string")
    : [];

  const oauth = new GoogleOAuthService(
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
      scopes: DEFAULT_SCOPES,
    },
    db,
    getEncryptionService(),
  );
  const auth = await oauth.createAuthenticatedClient(account.id);
  const cal = new GoogleCalendarService(
    auth,
    { primaryCalendarId, privateOpsCalendarId, defaultReminderDurationMinutes: 30 },
    db,
  );
  const result = await cal.syncTransactionMilestones(txn, { shareList });
  return {
    connected: true,
    created: result.created,
    alreadyLinked: result.alreadyLinked,
    attempted: result.attempted,
    errors: result.errors.length,
  };
}
