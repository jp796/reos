/**
 * POST /api/transactions/:id/ai-summary
 * Generates (and caches) an AI status summary for this transaction.
 *
 * GET /api/transactions/:id/ai-summary
 * Returns the cached summary if present (no regeneration).
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
import { TransactionSummaryService } from "@/services/ai/TransactionSummaryService";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = await prisma.transaction.findUnique({
    where: { id },
    select: { aiSummary: true, aiSummaryUpdatedAt: true },
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    summary: row.aiSummary,
    updatedAt: row.aiSummaryUpdatedAt?.toISOString() ?? null,
  });
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const account = await prisma.account.findUnique({
    where: { id: txn.accountId },
    select: { id: true, googleOauthTokensEncrypted: true },
  });

  let gmail: GmailService | null = null;
  if (
    account?.googleOauthTokensEncrypted &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REDIRECT_URI
  ) {
    try {
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
      const auth = await oauth.createAuthenticatedClient(account.id);
      gmail = new GmailService(
        account.id,
        auth,
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
    } catch (err) {
      console.warn("Gmail client unavailable for summary:", err);
    }
  }

  try {
    const svc = new TransactionSummaryService(
      prisma,
      gmail,
      env.OPENAI_API_KEY,
    );
    const result = await svc.summarize(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("AI summary failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "summary failed" },
      { status: 500 },
    );
  }
}
