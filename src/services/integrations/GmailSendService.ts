/**
 * GmailSendService — send a plain-text email from an account's connected
 * Gmail. Shared by note fan-out, @mention notifications, and automated
 * reminders (task/deadline). No-ops safely when Gmail isn't connected or the
 * OAuth env is missing, so callers can fire-and-forget.
 */

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export async function sendAccountGmail(input: {
  accountId: string;
  /** From: header identity (an account user's email). */
  fromEmail: string;
  recipients: string[];
  subject: string;
  text: string;
}): Promise<boolean> {
  const { accountId, fromEmail, subject, text } = input;
  const recipients = input.recipients.filter(Boolean);
  if (recipients.length === 0) return false;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI)
    return false;

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) return false;

  const { GoogleOAuthService, DEFAULT_SCOPES } = await import(
    "@/services/integrations/GoogleOAuthService"
  );
  const { getEncryptionService } = await import("@/lib/encryption");
  const { google } = await import("googleapis");

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
  const auth = await oauth.createAuthenticatedClient(accountId);
  const gmail = google.gmail({ version: "v1", auth });

  const lines = [
    `From: ${fromEmail}`,
    `To: ${recipients.join(", ")}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    text,
  ].join("\r\n");

  const raw = Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  return true;
}
