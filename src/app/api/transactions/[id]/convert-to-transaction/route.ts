/**
 * POST /api/transactions/:id/convert-to-transaction
 *
 * Promotes a listing (status='listing') into an active transaction
 * (status='active'). Stamps a contractDate (defaults to today,
 * overridable in the body) and optionally records the closing
 * date and side flip if the deal is dual-agency.
 *
 * Idempotent: if status is already 'active' / 'pending' / 'closed',
 * returns ok=true with noop=true.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";

export const runtime = "nodejs";

interface Body {
  contractDate?: string;
  closingDate?: string;
  /** Flip side to 'both' if we're now repping both sides. */
  dualAgency?: boolean;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true, status: true, side: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  if (txn.status !== "listing") {
    return NextResponse.json({ ok: true, noop: true, status: txn.status });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const contractDate = body.contractDate
    ? new Date(body.contractDate)
    : new Date();
  const closingDate = body.closingDate ? new Date(body.closingDate) : undefined;

  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      status: "active",
      side: body.dualAgency ? "both" : txn.side,
      contractDate,
      ...(closingDate ? { closingDate } : {}),
    },
    select: { id: true, status: true, side: true, contractDate: true },
  });

  // Audit
  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: txn.accountId,
        transactionId: id,
        entityType: "transaction",
        entityId: id,
        ruleName: "listing_converted_to_transaction",
        actionType: "update",
        sourceType: "manual",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: { status: "listing", side: txn.side },
        afterJson: {
          status: updated.status,
          side: updated.side,
          contractDate: updated.contractDate?.toISOString(),
        },
        actorUserId: actor.userId,
      },
    });
  } catch {
    // audit failure shouldn't block conversion
  }

  return NextResponse.json({ ok: true, transaction: updated });
}
