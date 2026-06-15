/**
 * POST /api/assets/:id/advance-stage — advance an Asset to the next
 * stage of its strategy lifecycle and instantiate that stage's tasks
 * (spec §6, §8.1). When the Asset has no current stage yet, this seeds
 * the first stage. At the final stage it's a no-op (done=true).
 *
 * Side effects on advance (both non-blocking):
 *   • Drive/Chat workspace scaffold (flag-gated, §7/§11).
 *   • Gmail SmartFolder activation when an INVESTOR deal first crosses
 *     into its market-entry stage (Flip→Prep-to-List, Wholesale→
 *     Disposition, BRRRR→Lease-Up). Investor deals stay Gmail-quiet
 *     through acquisition + rehab; this is where the inbox turns on.
 *
 * Tenancy: the Asset must belong to the caller's account.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { requireSession } from "@/lib/require-session";
import { advanceStage } from "@/services/core/StageEngine";
import { scaffoldDealWorkspace } from "@/services/automation/DealWorkspaceService";
import { marketEntryStage } from "@/services/core/strategyTemplates";
import type { Strategy } from "@/services/core/DealClassifierService";
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

/**
 * Activate the SmartFolder for an investor deal's primary transaction.
 * Non-blocking and idempotent — skips when no Gmail connection, env is
 * unset, or the deal already has a folder. Mirrors the construction in
 * create-from-scan.
 */
async function activateSmartFolder(accountId: string, assetId: string) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return;
  }
  const txn = await prisma.transaction.findFirst({
    where: { assetId, smartFolderFilterId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!txn) return;
  const acct = await prisma.account.findUnique({
    where: { id: accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!acct?.googleOauthTokensEncrypted) return;

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
  const auth = await oauth.createAuthenticatedClient(accountId);
  const gmail = new GmailService(
    accountId,
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
  const svc = new SmartFolderService({
    db: prisma,
    auth,
    gmail,
    audit: new AutomationAuditService(prisma),
  });
  await svc.setupForTransaction(txn.id);
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  // Tenancy — scope by accountId so a caller can't advance another
  // tenant's deal.
  const asset = await prisma.asset.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true, strategy: true, representation: true },
  });
  if (!asset) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await advanceStage(prisma, { assetId: asset.id });

  if (result.advanced) {
    // Drive/Chat workspace scaffold — no-op unless flags on. Non-blocking.
    try {
      await scaffoldDealWorkspace(prisma, { assetId: asset.id });
    } catch {
      // scaffoldDealWorkspace is contractually non-throwing; ignore.
    }

    // Gmail SmartFolder activation: fire exactly when an investor deal
    // crosses INTO its market-entry stage. Non-blocking.
    const entry = marketEntryStage(asset.strategy as Strategy);
    if (
      asset.representation === "principal" &&
      entry &&
      result.to === entry.key
    ) {
      try {
        await activateSmartFolder(actor.accountId, asset.id);
      } catch (err) {
        console.warn(
          "SmartFolder activation on market entry failed (non-blocking):",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return NextResponse.json({ ok: true, ...result });
}
