/**
 * POST /api/transactions/:id/ai-draft-reply
 *
 * Body: { threadId?: string }
 *
 * Builds an AI-drafted Gmail reply for the most recent inbound thread
 * tied to this transaction (or the specified threadId), saves it as
 * a Gmail draft on the TC's account, and returns the draft id so the
 * UI can deep-link the user to Gmail to review and send.
 *
 * Why drafts not auto-send:
 *   Real estate email touches legal + financial commitments. The AI
 *   is a force-multiplier for typing speed, not a substitute for
 *   human judgement. Drafts let the TC scan + edit + send in one
 *   second instead of fifteen minutes — without the AI ever pushing
 *   bits to the wire on its own.
 */

import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { EmailDraftService } from "@/services/ai/EmailDraftService";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true, account: { select: { googleOauthTokensEncrypted: true } } },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 });
  }
  if (!txn.account.googleOauthTokensEncrypted) {
    return NextResponse.json({ error: "Google not connected" }, { status: 400 });
  }
  if (!env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });
  }

  let body: { threadId?: string } = {};
  try {
    body = (await req.json()) as { threadId?: string };
  } catch {
    // optional body — empty is fine
  }

  // ── Wire up Gmail (wrapped for safe read) + raw client for drafts.create
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
  const gAuth = await oauth.createAuthenticatedClient(actor.accountId);
  // GmailService is wrapped by gmail-guard — it blocks send/drafts.create
  // on purpose. We use it for the read side (thread search, get).
  const gmailWrapped = new GmailService(
    actor.accountId,
    gAuth,
    {
      labelPrefix: "REOS/",
      autoOrganizeThreads: false,
      extractAttachments: false,
      batchSize: 10,
      rateLimitDelayMs: 100,
    },
    prisma,
    new EmailTransactionMatchingService(),
  );
  // Raw Gmail client for the actual drafts.create call. Matches the
  // pattern email/route.ts uses for messages.send (also blocked by
  // the guard wrapper).
  const gmailRaw = google.gmail({ version: "v1", auth: gAuth });

  // ── Generate the draft content via OpenAI
  let draft;
  try {
    const svc = new EmailDraftService(
      prisma,
      gmailWrapped,
      env.OPENAI_API_KEY,
      actor.email,
    );
    draft = await svc.draftReply(txn.id, body.threadId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // 404-shaped "no recent inbound" is a user-actionable condition,
    // not a server bug — surface as 400 so the client toasts clearly.
    const isUser = /No recent inbound email/i.test(msg);
    return NextResponse.json(
      { error: msg },
      { status: isUser ? 400 : 500 },
    );
  }

  // ── Build RFC822 message for Gmail.drafts.create.
  // Threading rule: set In-Reply-To + References to the source
  // message's Message-Id header, AND pass threadId on the parent
  // message envelope. Both are needed — threadId glues the draft to
  // the right Gmail conversation; In-Reply-To/References preserve
  // RFC822 threading for any non-Gmail recipient.
  const safeSubject = draft.subject.replace(/[\r\n]/g, " ");
  const headers = [
    `From: ${actor.email}`,
    `To: ${draft.replyTo}`,
  ];
  if (draft.cc.length > 0) {
    headers.push(`Cc: ${draft.cc.join(", ")}`);
  }
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

  let draftId: string | null = null;
  let draftMessageId: string | null = null;
  try {
    const res = await gmailRaw.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw,
          threadId: draft.threadId,
        },
      },
    });
    draftId = res.data.id ?? null;
    draftMessageId = res.data.message?.id ?? null;
  } catch (err) {
    const m = err instanceof Error ? err.message : "drafts.create failed";
    return NextResponse.json({ error: m }, { status: 502 });
  }

  // ── Audit log — who drafted what, for which deal. Lets you track
  // adoption ("our TCs used AI drafts on 84% of replies last week").
  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: actor.accountId,
        transactionId: txn.id,
        entityType: "email_draft",
        entityId: draftId,
        ruleName: "ai_draft_reply",
        actionType: "create",
        sourceType: "manual",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: Prisma.JsonNull,
        afterJson: {
          threadId: draft.threadId,
          replyTo: draft.replyTo,
          subject: draft.subject,
          model: draft.model,
        },
        actorUserId: actor.userId,
      },
    });
  } catch {
    // audit failure must never block the draft
  }

  return NextResponse.json({
    ok: true,
    draftId,
    draftMessageId,
    subject: draft.subject,
    threadId: draft.threadId,
    replyTo: draft.replyTo,
    cc: draft.cc,
    model: draft.model,
  });
}
