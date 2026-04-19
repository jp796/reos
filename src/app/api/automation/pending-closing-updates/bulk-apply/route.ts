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
import {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";

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
  const results: RowResult[] = [];
  let applied = 0;
  let skipped = 0;
  let errored = 0;

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
      await fub.updatePersonClosingDate(
        txn.contact.fubPersonId,
        row.extractedDate,
        {
          reason: "bulk_ss_reconcile_apply",
          transactionId: txn.id,
          previousDate: row.previousDate,
        },
      );

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
    results,
  });
}
