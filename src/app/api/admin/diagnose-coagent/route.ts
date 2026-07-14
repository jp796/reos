/**
 * POST /api/admin/diagnose-coagent   (owner only)
 * Body: { transactionId }
 *
 * Dry-run the co-op-agent email reader on a deal and report what it saw —
 * candidate senders, who got excluded, and the AI's verdict per candidate — so
 * we can see WHY the other agent did or didn't get pulled. Writes nothing.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";
import { GoogleOAuthService, DEFAULT_SCOPES } from "@/services/integrations/GoogleOAuthService";
import { GmailService, EmailTransactionMatchingService } from "@/services/integrations/GmailService";
import { diagnoseCoAgentFromEmails, captureCoAgentFromEmails } from "@/services/automation/CoAgentEmailCapture";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { transactionId?: string; write?: boolean } | null;
  const transactionId = body?.transactionId;
  const write = body?.write === true;
  if (!transactionId) return NextResponse.json({ error: "transactionId required" }, { status: 400 });

  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 400 });
  }

  const oauth = new GoogleOAuthService(
    { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI, scopes: DEFAULT_SCOPES },
    prisma,
    getEncryptionService(),
  );
  const gAuth = await oauth.createAuthenticatedClient(actor.accountId);
  const gmail = new GmailService(
    actor.accountId,
    gAuth,
    { labelPrefix: "REOS/", autoOrganizeThreads: false, extractAttachments: false, batchSize: 10, rateLimitDelayMs: 100 },
    prisma,
    new EmailTransactionMatchingService(),
  );

  if (write) {
    const captured = await captureCoAgentFromEmails(prisma, gmail, actor.accountId, transactionId);
    return NextResponse.json({ ok: true, mode: "write", captured });
  }
  const diag = await diagnoseCoAgentFromEmails(prisma, gmail, actor.accountId, transactionId);
  return NextResponse.json({ ok: true, ...diag });
}
