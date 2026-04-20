/**
 * POST /api/automation/smart-folders/backfill
 *
 * Set up smart folders for every transaction created on or after the
 * cutoff (2026-01-01) that doesn't already have one. Iterates one-at-a-
 * time so Gmail API rate limits don't blow up; collects per-row results.
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
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import {
  SmartFolderService,
  SMART_FOLDER_CUTOFF,
  type SmartFolderResult,
} from "@/services/automation/SmartFolderService";

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

  const txns = await prisma.transaction.findMany({
    where: {
      createdAt: { gte: SMART_FOLDER_CUTOFF },
      smartFolderFilterId: null,
      propertyAddress: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (txns.length === 0) {
    return NextResponse.json({
      ok: true,
      total: 0,
      configured: 0,
      skipped: 0,
      errored: 0,
      results: [],
    });
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

  const results: Array<{ transactionId: string; result: SmartFolderResult }> = [];
  let configured = 0;
  let skipped = 0;
  let errored = 0;

  for (const t of txns) {
    const r = await svc.setupForTransaction(t.id);
    results.push({ transactionId: t.id, result: r });
    if (r.configured) configured++;
    else if (r.reason?.startsWith("error") || r.reason === "insufficient_scope_reconnect_google")
      errored++;
    else skipped++;
  }

  return NextResponse.json({
    ok: true,
    total: txns.length,
    configured,
    skipped,
    errored,
    results,
  });
}
