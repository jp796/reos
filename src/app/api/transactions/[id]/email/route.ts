/**
 * POST /api/transactions/:id/email
 *
 * Body modes:
 *   { templateId, action: "preview" }  → return rendered subject/body
 *                                        + resolved/unresolved vars
 *   { templateId, action: "send", to, subject?, body?, cc? }
 *                                      → send via Gmail. `subject`/`body`
 *                                        can override the template's
 *                                        rendered version (user edits
 *                                        before send).
 *   { action: "send-raw", to, subject, body, cc? }
 *                                      → send without a template
 *                                        (ad-hoc email with merge).
 *
 * All sends go out as the authenticated user via the Gmail SEND scope
 * that's already in DEFAULT_SCOPES.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { google } from "googleapis";
import { Prisma } from "@prisma/client";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import {
  renderTemplate,
  type MergeInput,
} from "@/services/core/EmailMergeService";

export const runtime = "nodejs";

function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: {
      contact: true,
      financials: true,
      participants: { include: { contact: true } },
      account: true,
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as {
    templateId?: string;
    action?: "preview" | "send" | "send-raw";
    to?: string | string[];
    cc?: string | string[];
    subject?: string;
    body?: string;
  } | null;
  if (!body?.action) {
    return NextResponse.json({ error: "action required" }, { status: 400 });
  }

  // Brokerage metadata for mail-merge
  const settings = (txn.account.settingsJson ?? {}) as Record<string, unknown>;
  const brokerRaw = (settings.broker ?? {}) as Record<string, unknown>;
  const mergeInput: MergeInput = {
    txn,
    contact: txn.contact,
    financials: txn.financials,
    participants: txn.participants,
    brokerageName:
      (brokerRaw.brokerageName as string) ?? txn.account.businessName ?? undefined,
    agentName: (brokerRaw.agentName as string) ?? actor.name ?? undefined,
    agentEmail: actor.email,
  };

  let rendered: ReturnType<typeof renderTemplate> | null = null;

  if (body.templateId) {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: body.templateId },
    });
    if (!template) {
      return NextResponse.json({ error: "template not found" }, { status: 404 });
    }
    if (template.accountId !== actor.accountId) {
      return NextResponse.json({ error: "template not in your account" }, { status: 404 });
    }
    rendered = renderTemplate(
      { subject: template.subject, body: template.body },
      mergeInput,
    );
  }

  // Preview mode — no Gmail call
  if (body.action === "preview") {
    if (!rendered) {
      return NextResponse.json({ error: "templateId required for preview" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...rendered });
  }

  // Send modes require recipient list
  const toList = (
    Array.isArray(body.to) ? body.to : body.to ? [body.to] : []
  )
    .map((s) => s.trim())
    .filter(Boolean);
  if (toList.length === 0) {
    return NextResponse.json({ error: "to required" }, { status: 400 });
  }
  for (const addr of toList) {
    if (!validEmail(addr)) {
      return NextResponse.json({ error: `invalid recipient: ${addr}` }, { status: 400 });
    }
  }
  const ccList = (
    Array.isArray(body.cc) ? body.cc : body.cc ? [body.cc] : []
  )
    .map((s) => s.trim())
    .filter((s) => s && validEmail(s));

  // Final subject/body: user-supplied override > rendered > ad-hoc merge
  let subjectFinal: string;
  let bodyFinal: string;
  if (body.action === "send") {
    if (!rendered) {
      return NextResponse.json({ error: "templateId required for send" }, { status: 400 });
    }
    // If user edited, re-merge their edits so manual {{tokens}} still resolve
    const subjectRaw = body.subject ?? rendered.subject;
    const bodyRaw = body.body ?? rendered.body;
    const reMerged = renderTemplate({ subject: subjectRaw, body: bodyRaw }, mergeInput);
    subjectFinal = reMerged.subject;
    bodyFinal = reMerged.body;
  } else {
    // send-raw: merge whatever the user typed
    if (!body.subject?.trim() || !body.body?.trim()) {
      return NextResponse.json(
        { error: "subject + body required for send-raw" },
        { status: 400 },
      );
    }
    const reMerged = renderTemplate(
      { subject: body.subject, body: body.body },
      mergeInput,
    );
    subjectFinal = reMerged.subject;
    bodyFinal = reMerged.body;
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 });
  }
  if (!txn.account.googleOauthTokensEncrypted) {
    return NextResponse.json({ error: "Google not connected" }, { status: 400 });
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
  const gAuth = await oauth.createAuthenticatedClient(actor.accountId);
  const gmail = google.gmail({ version: "v1", auth: gAuth });

  // Build RFC 5322 message
  const fromEmail = actor.email;
  const headers = [
    `From: ${fromEmail}`,
    `To: ${toList.join(", ")}`,
  ];
  if (ccList.length > 0) headers.push(`Cc: ${ccList.join(", ")}`);
  headers.push(`Subject: ${subjectFinal.replace(/[\r\n]/g, " ")}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: 7bit");
  const message = headers.join("\r\n") + "\r\n\r\n" + bodyFinal;
  const raw = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    // Audit: who sent what, to where
    try {
      await prisma.automationAuditLog.create({
        data: {
          accountId: actor.accountId,
          transactionId: txn.id,
          entityType: "email",
          entityId: res.data.id ?? null,
          ruleName: body.templateId ? "send_from_template" : "send_raw",
          actionType: "create",
          sourceType: "manual",
          confidenceScore: 1.0,
          decision: "applied",
          beforeJson: Prisma.JsonNull,
          afterJson: {
            to: toList,
            cc: ccList,
            subject: subjectFinal,
            templateId: body.templateId ?? null,
            gmailMessageId: res.data.id,
          },
          actorUserId: actor.userId,
        },
      });
    } catch {
      // audit failure never blocks send
    }
    return NextResponse.json({
      ok: true,
      gmailMessageId: res.data.id,
      threadId: res.data.threadId,
      to: toList,
      cc: ccList,
      subject: subjectFinal,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "send failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
