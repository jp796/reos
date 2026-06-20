/**
 * ScheduledEmailService — send user-authored "send later" emails.
 *
 * sendGmailForAccount: build RFC822 + send via the account's Gmail.
 * processScheduledEmails: called by the hourly tick. Claims each due row
 * ATOMICALLY (pending → sending via a conditional updateMany) so two
 * overlapping ticks can never double-send, then sends once.
 */

import type { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { GoogleOAuthService, DEFAULT_SCOPES } from "@/services/integrations/GoogleOAuthService";

export async function sendGmailForAccount(
  db: PrismaClient,
  accountId: string,
  msg: { fromEmail: string; to: string[]; cc?: string[]; subject: string; body: string },
): Promise<{ gmailMessageId: string | null }> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth not configured");
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
  const gAuth = await oauth.createAuthenticatedClient(accountId);
  const gmail = google.gmail({ version: "v1", auth: gAuth });

  const headers = [`From: ${msg.fromEmail}`, `To: ${msg.to.join(", ")}`];
  if (msg.cc && msg.cc.length > 0) headers.push(`Cc: ${msg.cc.join(", ")}`);
  headers.push(`Subject: ${msg.subject.replace(/[\r\n]/g, " ")}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: 7bit");
  const raw = Buffer.from(headers.join("\r\n") + "\r\n\r\n" + msg.body)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  return { gmailMessageId: res.data.id ?? null };
}

export async function processScheduledEmails(
  db: PrismaClient,
): Promise<{ claimed: number; sent: number; failed: number }> {
  const now = new Date();
  const due = await db.scheduledEmail.findMany({
    where: { status: "pending", sendAt: { lte: now } },
    orderBy: { sendAt: "asc" },
    take: 50,
    select: {
      id: true,
      accountId: true,
      fromEmail: true,
      toJson: true,
      ccJson: true,
      subject: true,
      body: true,
      transactionId: true,
    },
  });

  let claimed = 0;
  let sent = 0;
  let failed = 0;
  for (const e of due) {
    // Atomic claim — only the worker whose update flips pending→sending
    // proceeds. Prevents double-send across overlapping ticks.
    const claim = await db.scheduledEmail.updateMany({
      where: { id: e.id, status: "pending" },
      data: { status: "sending", attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;
    claimed++;

    const to = Array.isArray(e.toJson) ? (e.toJson as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const cc = Array.isArray(e.ccJson) ? (e.ccJson as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (to.length === 0) {
      await db.scheduledEmail.update({
        where: { id: e.id },
        data: { status: "failed", lastError: "no recipients" },
      });
      failed++;
      continue;
    }
    try {
      const { gmailMessageId } = await sendGmailForAccount(db, e.accountId, {
        fromEmail: e.fromEmail,
        to,
        cc,
        subject: e.subject,
        body: e.body,
      });
      await db.scheduledEmail.update({
        where: { id: e.id },
        data: { status: "sent", sentAt: new Date(), gmailMessageId },
      });
      sent++;
      try {
        await db.automationAuditLog.create({
          data: {
            accountId: e.accountId,
            transactionId: e.transactionId,
            entityType: "email",
            entityId: gmailMessageId,
            ruleName: "scheduled_send",
            actionType: "create",
            sourceType: "automated",
            confidenceScore: 1.0,
            decision: "applied",
            afterJson: { to, cc, subject: e.subject, gmailMessageId },
          },
        });
      } catch {
        /* audit never blocks */
      }
    } catch (err) {
      await db.scheduledEmail.update({
        where: { id: e.id },
        data: { status: "failed", lastError: err instanceof Error ? err.message.slice(0, 300) : "send failed" },
      });
      failed++;
    }
  }
  return { claimed, sent, failed };
}
