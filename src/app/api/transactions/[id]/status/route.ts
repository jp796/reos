/**
 * PATCH /api/transactions/:id/status
 * Body: { status: "active" | "pending" | "closed" | "dead", closingDate?: ISO }
 *
 * Flip a transaction's status (e.g. mark closed from the /transactions list
 * when the deal already closed but we haven't yet reconciled its SS).
 * Also cascades: if we just flipped to closed, every still-pending
 * milestone auto-completes as of the closing date or today.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import { parseInputDate } from "@/lib/dates";

const STATUSES = new Set(["active", "pending", "closed", "dead"]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as {
    status?: string;
    closingDate?: string | null;
  } | null;
  if (!body?.status || !STATUSES.has(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...STATUSES].join(", ")}` },
      { status: 400 },
    );
  }

  const data: Prisma.TransactionUpdateInput = { status: body.status };
  if (body.closingDate !== undefined) {
    if (body.closingDate === null) {
      data.closingDate = null;
    } else {
      const d = parseInputDate(body.closingDate) ?? new Date();
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "invalid closingDate" },
          { status: 400 },
        );
      }
      data.closingDate = d;
    }
  }

  await prisma.transaction.update({ where: { id }, data });

  // Cascade-complete milestones if we just flipped to closed.
  let milestonesAutoCompleted = 0;
  if (body.status === "closed") {
    const stamp =
      (data.closingDate instanceof Date ? data.closingDate : null) ??
      txn.closingDate ??
      new Date();
    const updated = await prisma.milestone.updateMany({
      where: { transactionId: id, completedAt: null },
      data: { completedAt: stamp, status: "completed" },
    });
    milestonesAutoCompleted = updated.count;
  }

  try {
    const audit = new AutomationAuditService(prisma);
    await audit.logAction({
      accountId: actor.accountId,
      transactionId: id,
      entityType: "transaction",
      entityId: id,
      ruleName: "manual_status_change",
      actionType: "update",
      sourceType: "manual",
      confidenceScore: 1.0,
      decision: "applied",
      beforeJson: { status: txn.status, closingDate: txn.closingDate },
      afterJson: {
        status: body.status,
        closingDate: data.closingDate ?? txn.closingDate,
        milestonesAutoCompleted,
      },
      actorUserId: actor.userId,
    });
  } catch {
    // never block the status change on audit failure
  }

  return NextResponse.json({ ok: true, milestonesAutoCompleted });
}
