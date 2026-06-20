/**
 * draftReplyForDeal — AI-draft a reply to the latest inbound email on a
 * deal and SAVE it as a Gmail draft (never sends). Shared core extracted
 * from the ai-draft-reply route so the Atlas `draft_reply` tool produces
 * the same draft the in-app button does.
 *
 * Throws { userMessage } for actionable conditions (no inbound, Gmail not
 * connected) so callers can surface them cleanly.
 */

import type { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { GoogleOAuthService, DEFAULT_SCOPES } from "@/services/integrations/GoogleOAuthService";
import { GmailService, EmailTransactionMatchingService } from "@/services/integrations/GmailService";
import { EmailDraftService } from "@/services/ai/EmailDraftService";

export class DraftReplyError extends Error {}

export async function draftReplyForDeal(
  db: PrismaClient,
  actor: { accountId: string; email: string },
  transactionId: string,
  threadId?: string,
): Promise<{ draftId: string | null; subject: string; to: string }> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new DraftReplyError("Google OAuth isn't configured.");
  }
  if (!env.OPENAI_API_KEY) throw new DraftReplyError("AI isn't configured.");

  const account = await db.account.findUnique({
    where: { id: actor.accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    throw new DraftReplyError("Gmail isn't connected — connect it in Settings → Integrations.");
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
  const gAuth = await oauth.createAuthenticatedClient(actor.accountId);
  const gmailWrapped = new GmailService(
    actor.accountId,
    gAuth,
    { labelPrefix: "REOS/", autoOrganizeThreads: false, extractAttachments: false, batchSize: 10, rateLimitDelayMs: 100 },
    db,
    new EmailTransactionMatchingService(),
  );
  const gmailRaw = google.gmail({ version: "v1", auth: gAuth });

  let draft;
  try {
    const svc = new EmailDraftService(db, gmailWrapped, env.OPENAI_API_KEY, actor.email);
    draft = await svc.draftReply(transactionId, threadId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "draft failed";
    throw new DraftReplyError(
      /No recent inbound email/i.test(msg)
        ? "No recent inbound email on this deal to reply to."
        : msg,
    );
  }

  const safeSubject = draft.subject.replace(/[\r\n]/g, " ");
  const headers = [`From: ${actor.email}`, `To: ${draft.replyTo}`];
  if (draft.cc.length > 0) headers.push(`Cc: ${draft.cc.join(", ")}`);
  headers.push(`Subject: ${safeSubject}`);
  if (draft.replyToMessageId) {
    headers.push(`In-Reply-To: ${draft.replyToMessageId}`);
    headers.push(`References: ${draft.replyToMessageId}`);
  }
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: 7bit");
  const message = headers.join("\r\n") + "\r\n\r\n" + draft.body;
  const raw = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmailRaw.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw, threadId: draft.threadId } },
  });
  return { draftId: res.data.id ?? null, subject: safeSubject, to: draft.replyTo };
}
