/**
 * POST /api/transactions/:id/smart-folder
 *
 * Manually trigger smart-folder setup for one transaction. Used from
 * the transaction detail page so users can bootstrap the folder for
 * txns that were created before the auto-trigger was wired in.
 *
 * Respects the 2026-01-01 cutoff — pre-cutoff txns get a 400.
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
import {
  SmartFolderService,
  SMART_FOLDER_CUTOFF,
} from "@/services/automation/SmartFolderService";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (txn.createdAt < SMART_FOLDER_CUTOFF) {
    return NextResponse.json(
      {
        error: `SmartFolder only applies to transactions created on or after ${SMART_FOLDER_CUTOFF.toISOString().slice(0, 10)}`,
      },
      { status: 400 },
    );
  }

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

  const result = await svc.setupForTransaction(txn.id);
  return NextResponse.json({ ok: true, result });
}
