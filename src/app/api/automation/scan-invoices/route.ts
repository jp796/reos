/**
 * POST /api/automation/scan-invoices
 *
 * Scan every transaction's SmartFolder for invoice-shaped emails
 * (inspection, HOA, warranty, repair, utility, title). Creates
 * pending InvoiceEntry rows for the user to review.
 */

import { NextResponse } from "next/server";
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
import { InvoiceScanService } from "@/services/automation/InvoiceScanService";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const account = await prisma.account.findFirst({
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
      extractAttachments: true,
      batchSize: 10,
      rateLimitDelayMs: 100,
    },
    prisma,
    new EmailTransactionMatchingService(),
  );

  const svc = new InvoiceScanService(prisma, gmail);
  const result = await svc.scanAll(account.id);
  return NextResponse.json({ ok: true, ...result });
}
