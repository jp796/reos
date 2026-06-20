/**
 * gmailForAccount — build a read-capable GmailService for an account's
 * connected Gmail, or null if Gmail isn't connected / OAuth env missing.
 *
 * Centralizes the OAuth-client boilerplate that the search-gmail route
 * and the Atlas check_inbox tool both need. The returned client is
 * wrapped by makeSafeGmail (no send/delete) — read + label only.
 */

import type { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { GoogleOAuthService, DEFAULT_SCOPES } from "./GoogleOAuthService";
import { GmailService, EmailTransactionMatchingService } from "./GmailService";

export async function gmailForAccount(
  db: PrismaClient,
  accountId: string,
): Promise<GmailService | null> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { id: true, googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) return null;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return null;
  }
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
  const gAuth = await oauth.createAuthenticatedClient(account.id);
  return new GmailService(
    account.id,
    gAuth,
    {
      labelPrefix: "REOS/",
      autoOrganizeThreads: false,
      extractAttachments: true,
      batchSize: 10,
      rateLimitDelayMs: 100,
    },
    db,
    new EmailTransactionMatchingService(),
  );
}
