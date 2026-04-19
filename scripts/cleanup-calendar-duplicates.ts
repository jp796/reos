/**
 * Clean up the 7 duplicate milestone calendar events that were created
 * before the milestoneId-based dedup was shipped.
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/cleanup-calendar-duplicates.ts
 */

import { PrismaClient } from "@prisma/client";
import { GoogleOAuthService, DEFAULT_SCOPES } from "../src/services/integrations/GoogleOAuthService";
import { GoogleCalendarService } from "../src/services/integrations/GoogleCalendarService";
import { EncryptionService } from "../src/lib/encryption";

async function main() {
  const db = new PrismaClient();
  const enc = new EncryptionService();

  const account = await db.account.findFirst({ select: { id: true, googleOauthTokensEncrypted: true, settingsJson: true } });
  if (!account?.googleOauthTokensEncrypted) {
    console.error("Google not connected");
    process.exit(1);
  }

  const oauth = new GoogleOAuthService(
    {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
      scopes: DEFAULT_SCOPES,
    },
    db,
    enc,
  );

  const auth = await oauth.createAuthenticatedClient(account.id);
  const cal = new GoogleCalendarService(
    auth,
    { primaryCalendarId: "primary" },
    db,
  );

  console.log("Cleaning up duplicate milestone events...");
  const res = await cal.cleanupMilestoneDuplicates(account.id);
  console.log(`Groups with duplicates: ${res.groups}`);
  console.log(`Events cancelled: ${res.cancelled}`);
  if (res.errors.length) {
    console.log("Errors:");
    res.errors.forEach((e) => console.log(`  ${e.eventId}: ${e.error}`));
  }
  await db.$disconnect();
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
