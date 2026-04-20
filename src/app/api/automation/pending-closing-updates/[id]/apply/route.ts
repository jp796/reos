/**
 * POST /api/automation/pending-closing-updates/:id/apply
 *
 * Push the extracted closing date to FUB (person.dealCloseDate) AND
 * update the local Transaction.closingDate. Marks the pending row as
 * applied.
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
import {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";
import { autoPopulateFinancials } from "@/services/core/FinancialsAutoPopulate";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = await prisma.pendingClosingDateUpdate.findUnique({
    where: { id },
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `already ${row.status}` },
      { status: 409 },
    );
  }

  if (!env.FUB_API_KEY) {
    return NextResponse.json(
      { error: "FUB_API_KEY not configured" },
      { status: 500 },
    );
  }

  const txn = await prisma.transaction.findUnique({
    where: { id: row.transactionId },
    include: { contact: true },
  });
  if (!txn) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }

  let fubDateUpdated = false;
  let fubStageUpdated = false;
  if (txn.contact.fubPersonId) {
    const audit = new AutomationAuditService(prisma);
    const fub = new FollowUpBossService(
      row.accountId,
      {
        apiKey: env.FUB_API_KEY,
        systemKey: env.FUB_SYSTEM_KEY,
        webhookSecret: env.FUB_WEBHOOK_SECRET,
      },
      prisma,
      audit,
    );
    // FUB doesn't expose dealCloseDate as a writable field on /people —
    // best-effort push; non-fatal.
    try {
      await fub.updatePersonClosingDate(
        txn.contact.fubPersonId,
        row.extractedDate,
        {
          reason: "settlement_statement_apply",
          transactionId: txn.id,
          previousDate: row.previousDate,
        },
      );
      fubDateUpdated = true;
    } catch (err) {
      console.warn(
        "FUB closing-date update failed (continuing with stage + local):",
        err instanceof Error ? err.message : String(err),
      );
    }

    if (row.proposedStage) {
      try {
        await fub.updatePersonStage(
          txn.contact.fubPersonId,
          row.proposedStage,
          {
            reason: "settlement_statement_apply",
            transactionId: txn.id,
          },
        );
        fubStageUpdated = true;
      } catch (err) {
        // Non-fatal — closing date already pushed. Log and continue.
        console.warn("FUB stage update failed:", err);
      }
    }
  }

  // Local writes: closing date + (if proposedStage=Closed) status=closed
  const localStatus =
    row.proposedStage && /closed/i.test(row.proposedStage) ? "closed" : undefined;
  await prisma.transaction.update({
    where: { id: txn.id },
    data: {
      closingDate: row.extractedDate,
      ...(localStatus ? { status: localStatus } : {}),
    },
  });

  await prisma.pendingClosingDateUpdate.update({
    where: { id: row.id },
    data: { status: "applied", appliedAt: new Date() },
  });

  // Auto-populate financials from the SS attachment (best-effort; failures
  // never block the core Apply).
  let financialsResult: Awaited<ReturnType<typeof autoPopulateFinancials>> = {
    attempted: false,
    populated: false,
  };
  try {
    const account = await prisma.account.findUnique({
      where: { id: row.accountId },
      select: { id: true, googleOauthTokensEncrypted: true },
    });
    let gmail: GmailService | null = null;
    if (
      account?.googleOauthTokensEncrypted &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REDIRECT_URI
    ) {
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
      const auth = await oauth.createAuthenticatedClient(row.accountId);
      gmail = new GmailService(
        row.accountId,
        auth,
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
    }
    const audit = new AutomationAuditService(prisma);
    financialsResult = await autoPopulateFinancials(prisma, gmail, audit, {
      accountId: row.accountId,
      transactionId: row.transactionId,
      threadId: row.threadId,
      attachmentId: row.attachmentId,
      side: (row.side as "buy" | "sell" | null) ?? null,
    });
  } catch (err) {
    console.warn("Financials auto-populate failed:", err);
  }

  return NextResponse.json({
    ok: true,
    fubDateUpdated,
    fubStageUpdated,
    newClosingDate: row.extractedDate.toISOString(),
    newStage: row.proposedStage ?? null,
    financials: financialsResult,
  });
}
