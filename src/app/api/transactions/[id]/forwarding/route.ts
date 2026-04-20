/**
 * PATCH /api/transactions/:id/forwarding
 *   Body: { forwardingEmail, forwardingEmailProvider } — update or clear
 *
 * POST  /api/transactions/:id/forwarding
 *   Run the forwarding pipeline for this transaction NOW: scan its
 *   SmartFolder label, forward every not-yet-forwarded PDF to the
 *   configured address.
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
import { TransactionForwardingService } from "@/services/automation/TransactionForwardingService";

const VALID_PROVIDERS = new Set([
  "dotloop",
  "rezen",
  "skyslope",
  "dealpack",
  "brokermint",
  "other",
]);

export const runtime = "nodejs";
export const maxDuration = 90;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    forwardingEmail?: string | null;
    forwardingEmailProvider?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const email =
    typeof body.forwardingEmail === "string"
      ? body.forwardingEmail.trim().toLowerCase()
      : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  const provider =
    typeof body.forwardingEmailProvider === "string"
      ? body.forwardingEmailProvider.trim().toLowerCase()
      : null;
  if (provider && !VALID_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${[...VALID_PROVIDERS].join(", ")}` },
      { status: 400 },
    );
  }

  await prisma.transaction.update({
    where: { id },
    data: {
      forwardingEmail: email || null,
      forwardingEmailProvider: provider || null,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!txn.forwardingEmail) {
    return NextResponse.json(
      { error: "no forwarding email configured on this transaction" },
      { status: 400 },
    );
  }
  if (!txn.smartFolderLabelId) {
    return NextResponse.json(
      {
        error:
          "SmartFolder not set up — create one first so we know which emails to forward",
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
  const stored = await oauth.getStoredTokens(account.id);
  const ownerEmail = stored?.userEmail;
  if (!ownerEmail) {
    return NextResponse.json(
      { error: "owner email unknown — reconnect Google" },
      { status: 500 },
    );
  }

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
  const audit = new AutomationAuditService(prisma);
  const svc = new TransactionForwardingService(
    prisma,
    gmail,
    audit,
    gAuth,
    ownerEmail,
  );

  try {
    const result = await svc.forwardForTransaction(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "forward failed" },
      { status: 500 },
    );
  }
}
