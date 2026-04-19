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
import {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";

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
      console.error("FUB closing-date update failed:", err);
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "FUB update failed",
        },
        { status: 500 },
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

  return NextResponse.json({
    ok: true,
    fubDateUpdated,
    fubStageUpdated,
    newClosingDate: row.extractedDate.toISOString(),
    newStage: row.proposedStage ?? null,
  });
}
