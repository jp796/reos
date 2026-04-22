/**
 * POST /api/transactions/:id/smart-folder/learn
 *
 * Reads every thread currently in the transaction's SmartFolder
 * label, extracts high-confidence patterns (senders, subject
 * tokens), and rewrites the Gmail filter so future emails
 * matching those patterns auto-file into the same folder.
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
import { GmailFilterService } from "@/services/integrations/GmailFilterService";
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import { SmartFolderLearnService } from "@/services/automation/SmartFolderLearnService";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: { contact: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!txn.smartFolderLabelId) {
    return NextResponse.json(
      { error: "SmartFolder not set up for this transaction yet" },
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
  const ownerEmail = stored?.userEmail ?? "";

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

  // Rebuild the base query — same logic the initial setup used:
  // contact email + address phrases. We OR in the learned signals.
  const filters = new GmailFilterService(gAuth);

  const street = (txn.propertyAddress ?? "").split(",")[0]?.trim() ?? "";
  const baseEmails: string[] = [];
  if (txn.contact.primaryEmail) baseEmails.push(txn.contact.primaryEmail);
  const basePhrases: string[] = [];
  if (street.length >= 4) basePhrases.push(street);
  const streetNum = street.match(/\b(\d{3,6})\b/)?.[1];
  if (streetNum) {
    const after = street.slice(street.indexOf(streetNum) + streetNum.length).trim();
    if (after.length >= 3) basePhrases.push(`${streetNum} ${after}`);
  }
  const baseQuery =
    GmailFilterService.buildQuery({
      emails: baseEmails,
      subjectPhrases: basePhrases,
    }) ?? "";

  const svc = new SmartFolderLearnService({
    db: prisma,
    gmail,
    audit: new AutomationAuditService(prisma),
    filters,
    labelId: txn.smartFolderLabelId,
    ownerEmail,
    existingFilterId: txn.smartFolderFilterId,
    baseQuery,
  });

  const result = await svc.learn(id);
  return NextResponse.json(result);
}
