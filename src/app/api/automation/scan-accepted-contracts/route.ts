/**
 * POST /api/automation/scan-accepted-contracts
 *
 * Body: { days?: number }
 *
 * Scans Gmail for executed purchase contracts with future closing
 * dates. Returns hits with extracted fields + any matched
 * transaction/contact in our DB.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { requireSession } from "@/lib/require-session";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";
import { AcceptedContractScanService } from "@/services/automation/AcceptedContractScanService";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { days?: number };

  // Tenancy guard: see create-from-scan/route.ts. Pull settingsJson
  // up front in the same call so we don't need a second findUnique
  // below for the trusted-TC sender allowlist.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: {
      id: true,
      googleOauthTokensEncrypted: true,
      settingsJson: true,
    },
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
    !env.GOOGLE_REDIRECT_URI ||
    !env.OPENAI_API_KEY
  ) {
    return NextResponse.json(
      { error: "Google OAuth or OpenAI env not configured" },
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
  const svc = new AcceptedContractScanService(
    prisma,
    gmail,
    new ContractExtractionService(env.OPENAI_API_KEY),
  );

  // Pull the user-configured trusted-TC sender allowlist so the scan
  // also surfaces threads from outside coordinators that don't carry
  // the usual contract-keyword markers in the subject.
  const settings = (account.settingsJson ?? {}) as Record<string, unknown>;
  const trustedSenders = Array.isArray(settings.trustedTcSenders)
    ? (settings.trustedTcSenders as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  const result = await svc.scan({ days: body.days, trustedSenders });
  return NextResponse.json({ ok: true, ...result });
}
