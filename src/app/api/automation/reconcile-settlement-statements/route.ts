/**
 * POST /api/automation/reconcile-settlement-statements?days=365&max=2000
 *
 * Implements the SSReconciliation skill: scans Gmail for Settlement
 * Statement attachments, extracts parties + close dates, queues
 * PendingClosingDateUpdate rows with proposedStage='Closed'.
 *
 * NEVER auto-applies. User clicks Apply in the review panel per row.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { GmailService, EmailTransactionMatchingService } from "@/services/integrations/GmailService";
import { TransactionService } from "@/services/core/TransactionService";
import { DocumentExtractionService } from "@/services/ai/DocumentExtractionService";
import { SSReconciliationService } from "@/services/automation/SSReconciliationService";

function clampInt(raw: string | null, min: number, max: number, dflt: number) {
  if (!raw) return dflt;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

export async function POST(req: NextRequest) {
  const days = clampInt(req.nextUrl.searchParams.get("days"), 1, 1825, 365);
  const max = clampInt(req.nextUrl.searchParams.get("max"), 1, 10000, 2000);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return NextResponse.json(
      { error: "GOOGLE_* env vars not configured" },
      { status: 500 },
    );
  }

  const account = await prisma.account.findFirst({
    select: { id: true, googleOauthTokensEncrypted: true },
  });
  if (!account) return NextResponse.json({ error: "no account" }, { status: 500 });
  if (!account.googleOauthTokensEncrypted) {
    return NextResponse.json(
      { error: "Google not connected", connectUrl: `/api/auth/google?accountId=${account.id}` },
      { status: 412 },
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

  const startedAt = Date.now();
  try {
    const auth = await oauth.createAuthenticatedClient(account.id);
    const stored = await oauth.getStoredTokens(account.id);
    const selfEmails: string[] = stored?.userEmail ? [stored.userEmail] : [];

    const gmail = new GmailService(
      account.id,
      auth,
      {
        labelPrefix: "REOS/",
        autoOrganizeThreads: true,
        extractAttachments: true,
        batchSize: 50,
        rateLimitDelayMs: 100,
      },
      prisma,
      new EmailTransactionMatchingService(),
    );

    const svc = new SSReconciliationService(
      account.id,
      prisma,
      gmail,
      new DocumentExtractionService(),
      new TransactionService(prisma),
      selfEmails,
    );

    const result = await svc.reconcileRecent({ daysBack: days, maxThreads: max });
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      result,
    });
  } catch (err) {
    console.error("SS reconcile failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed", durationMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}
