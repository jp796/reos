/**
 * POST /api/transactions/:id/smart-folder/rebackfill
 *
 * Re-scans Gmail with the transaction's CURRENT address + contact
 * emails and applies the label to any matching threads. Used when a
 * folder was created early (TBD address, contact had no email yet)
 * and missed threads. Idempotent — Gmail label-apply is safe to
 * repeat on already-labeled threads.
 */

import { NextResponse, type NextRequest } from "next/server";
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
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import { SmartFolderService } from "@/services/automation/SmartFolderService";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const account = await prisma.account.findUnique({
    where: { id: txn.accountId },
    select: { id: true, googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    return NextResponse.json(
      { error: "Google not connected" },
      { status: 412 },
    );
  }
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return NextResponse.json(
      { error: "Google OAuth env not configured" },
      { status: 500 },
    );
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
  const gAuth = await oauth.createAuthenticatedClient(account.id);
  const gmail = new GmailService(
    account.id,
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
  const audit = new AutomationAuditService(prisma);
  const svc = new SmartFolderService({ db: prisma, auth: gAuth, gmail, audit });

  const result = await svc.rebackfill(id);
  return NextResponse.json(result);
}
