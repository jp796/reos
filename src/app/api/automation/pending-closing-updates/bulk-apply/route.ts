/**
 * POST /api/automation/pending-closing-updates/bulk-apply
 *
 * Apply every pending row in a single request. Each row runs the same
 * logic as the per-row /:id/apply endpoint:
 *   - update FUB dealCloseDate
 *   - if proposedStage is set, update FUB stage + flip local txn status
 *   - mark pending row as applied
 * Errors on individual rows are collected; other rows still apply.
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
import {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";
import { autoPopulateFinancials } from "@/services/core/FinancialsAutoPopulate";

interface RowResult {
  id: string;
  contactName: string;
  status: "applied" | "error" | "skipped";
  reason?: string;
  newClosingDate?: string;
  newStage?: string;
}

export async function POST() {
  if (!env.FUB_API_KEY) {
    return NextResponse.json(
      { error: "FUB_API_KEY not configured" },
      { status: 500 },
    );
  }

  const pending = await prisma.pendingClosingDateUpdate.findMany({
    where: { status: "pending" },
    orderBy: { detectedAt: "desc" },
  });

  const audit = new AutomationAuditService(prisma);

  // Build a single Gmail client once — shared across all rows for auto-
  // populating financials from SS attachments. If Google isn't connected,
  // the helper falls back gracefully.
  let gmail: GmailService | null = null;
  const account = await prisma.account.findFirst({
    select: { id: true, googleOauthTokensEncrypted: true },
  });
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
          extractAttachments: true,
          batchSize: 10,
          rateLimitDelayMs: 100,
        },
        prisma,
        new EmailTransactionMatchingService(),
      );
    } catch (err) {
      console.warn("Gmail unavailable for bulk-apply financials:", err);
    }
  }

  const results: RowResult[] = [];
  let applied = 0;
  let skipped = 0;
  let errored = 0;
  let financialsPopulated = 0;

  for (const row of pending) {
    const txn = await prisma.transaction.findUnique({
      where: { id: row.transactionId },
      include: { contact: true },
    });
    if (!txn) {
      errored++;
      results.push({
        id: row.id,
        contactName: "—",
        status: "error",
        reason: "transaction not found",
      });
      continue;
    }

    const contactName = txn.contact.fullName;

    if (!txn.contact.fubPersonId) {
      // No FUB link — flip local state only (closingDate + status)
      const localStatus =
        row.proposedStage && /closed/i.test(row.proposedStage)
          ? "closed"
          : undefined;
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
      skipped++;
      results.push({
        id: row.id,
        contactName,
        status: "skipped",
        reason: "no fubPersonId — local only",
        newClosingDate: row.extractedDate.toISOString(),
        newStage: row.proposedStage ?? undefined,
      });
      continue;
    }

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

    try {
      // Closing-date push is best-effort (FUB doesn't accept dealCloseDate
      // as a writable field on /people for all accounts).
      try {
        await fub.updatePersonClosingDate(
          txn.contact.fubPersonId,
          row.extractedDate,
          {
            reason: "bulk_ss_reconcile_apply",
            transactionId: txn.id,
            previousDate: row.previousDate,
          },
        );
      } catch (err) {
        console.warn(
          `dealCloseDate push failed for ${contactName} (continuing):`,
          err instanceof Error ? err.message : String(err),
        );
      }

      if (row.proposedStage) {
        try {
          await fub.updatePersonStage(
            txn.contact.fubPersonId,
            row.proposedStage,
            {
              reason: "bulk_ss_reconcile_apply",
              transactionId: txn.id,
            },
          );
        } catch (err) {
          console.warn(`stage update failed for ${contactName}:`, err);
        }
      }

      const localStatus =
        row.proposedStage && /closed/i.test(row.proposedStage)
          ? "closed"
          : undefined;
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

      applied++;

      // Best-effort financials populate — never blocks the core apply.
      try {
        const r = await autoPopulateFinancials(prisma, gmail, audit, {
          accountId: row.accountId,
          transactionId: row.transactionId,
          threadId: row.threadId,
          attachmentId: row.attachmentId,
          side: (row.side as "buy" | "sell" | null) ?? null,
        });
        if (r.populated) financialsPopulated++;
      } catch (err) {
        console.warn(`financials auto-populate failed for ${contactName}:`, err);
      }

      results.push({
        id: row.id,
        contactName,
        status: "applied",
        newClosingDate: row.extractedDate.toISOString(),
        newStage: row.proposedStage ?? undefined,
      });
    } catch (err) {
      errored++;
      results.push({
        id: row.id,
        contactName,
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    total: pending.length,
    applied,
    skipped,
    errored,
    financialsPopulated,
    results,
  });
}
