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

const COMPOSE_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

/**
 * draftNewEmailForDeal — compose a BRAND-NEW email (not a reply) for a
 * deal and save it as a Gmail draft. Resolves the recipient from the
 * deal's parties (by role, name, or literal email), generates a
 * professional subject + body from deal facts + the user's intent, and
 * saves the draft (never sends).
 */
export async function draftNewEmailForDeal(
  db: PrismaClient,
  actor: { accountId: string; email: string },
  transactionId: string,
  opts: { to: string; about: string },
): Promise<{ draftId: string | null; subject: string; to: string }> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new DraftReplyError("Google OAuth isn't configured.");
  }
  const key = env.OPENAI_API_KEY;
  if (!key) throw new DraftReplyError("AI isn't configured.");

  const txn = await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      accountId: true,
      propertyAddress: true,
      side: true,
      contractDate: true,
      closingDate: true,
      inspectionDate: true,
      earnestMoneyDueDate: true,
      titleCompanyName: true,
      lenderName: true,
      account: { select: { googleOauthTokensEncrypted: true } },
      contact: { select: { fullName: true, primaryEmail: true } },
      participants: {
        select: { role: true, contact: { select: { fullName: true, primaryEmail: true } } },
      },
      financials: { select: { salePrice: true } },
    },
  });
  if (!txn) throw new DraftReplyError("Deal not found.");
  if (!txn.account.googleOauthTokensEncrypted) {
    throw new DraftReplyError("Gmail isn't connected — connect it in Settings → Integrations.");
  }

  // Resolve recipient. Literal email wins; else match role or name
  // against parties + primary contact.
  const want = opts.to.trim().toLowerCase();
  const candidates: { label: string; role: string; email: string | null }[] = [
    { label: txn.contact?.fullName ?? "primary", role: "primary", email: txn.contact?.primaryEmail ?? null },
    ...txn.participants.map((p) => ({
      label: p.contact.fullName,
      role: p.role,
      email: p.contact.primaryEmail,
    })),
  ];
  let toEmail: string | null = null;
  if (want.includes("@")) {
    toEmail = opts.to.trim();
  } else {
    const hit =
      candidates.find((c) => c.email && c.role.toLowerCase() === want) ||
      candidates.find((c) => c.email && c.label.toLowerCase().includes(want)) ||
      candidates.find((c) => c.email && want.includes(c.role.toLowerCase().replace(/_/g, " ")));
    toEmail = hit?.email ?? null;
  }
  if (!toEmail) {
    throw new DraftReplyError(`Couldn't find an email for "${opts.to}" on this deal. Add their email to the parties, or give me the address.`);
  }

  const facts = {
    propertyAddress: txn.propertyAddress,
    side: txn.side,
    contractDate: txn.contractDate ? txn.contractDate.toISOString().slice(0, 10) : null,
    closingDate: txn.closingDate ? txn.closingDate.toISOString().slice(0, 10) : null,
    inspectionDeadline: txn.inspectionDate ? txn.inspectionDate.toISOString().slice(0, 10) : null,
    earnestMoneyDue: txn.earnestMoneyDueDate ? txn.earnestMoneyDueDate.toISOString().slice(0, 10) : null,
    salePrice: txn.financials?.salePrice ?? null,
    titleCompany: txn.titleCompanyName,
    lender: txn.lenderName,
  };

  const sys = `You write professional, concise real estate transaction emails on behalf of ${actor.email}.
Return STRICT JSON: { "subject": string, "body": string }.
- Warm, clear, professional. Plain text body (no markdown).
- Use the deal facts only where relevant; never invent figures or dates.
- Sign off with the sender's name implied (do not fabricate a signature block).`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: COMPOSE_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.4,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Deal facts: ${JSON.stringify(facts)}\n\nWrite an email to ${toEmail} about: ${opts.about.slice(0, 400)}` },
      ],
    }),
  });
  if (!res.ok) throw new DraftReplyError(`AI error ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  let parsed: { subject?: string; body?: string };
  try {
    parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  } catch {
    throw new DraftReplyError("AI returned an unreadable draft.");
  }
  const subject = (parsed.subject || `Regarding ${txn.propertyAddress ?? "your transaction"}`).replace(/[\r\n]/g, " ");
  const bodyText = parsed.body || "";
  if (!bodyText.trim()) throw new DraftReplyError("AI returned an empty draft.");

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
  const gmailRaw = google.gmail({ version: "v1", auth: gAuth });
  const message =
    [
      `From: ${actor.email}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 7bit",
    ].join("\r\n") +
    "\r\n\r\n" +
    bodyText;
  const raw = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const created = await gmailRaw.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });
  return { draftId: created.data.id ?? null, subject, to: toEmail };
}
