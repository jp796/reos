/**
 * POST /api/transactions/:id/financials
 *
 * Upsert the TransactionFinancials row for a transaction. Accepts
 * numbers for salePrice, grossCommission, referralFeeAmount,
 * brokerageSplitAmount, marketingCostAllocated. Auto-computes
 * netCommission = gross - referral - split - marketing.
 *
 * Missing fields are treated as "no change" on update and null on create.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";

interface Body {
  salePrice?: number | null;
  commissionPercent?: number | null;
  grossCommission?: number | null;
  referralFeePercent?: number | null;
  referralFeeAmount?: number | null;
  brokerageSplitPercent?: number | null;
  brokerageSplitAmount?: number | null;
  marketingCostAllocated?: number | null;
}

function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function POST(
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

  const previous = await prisma.transactionFinancials.findUnique({
    where: { transactionId: id },
  });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const salePrice = asNum(body.salePrice);
  const grossCommission = asNum(body.grossCommission);
  const referralFeeAmount = asNum(body.referralFeeAmount) ?? 0;
  const brokerageSplitAmount = asNum(body.brokerageSplitAmount) ?? 0;
  const marketingCostAllocated = asNum(body.marketingCostAllocated) ?? 0;

  const netCommission =
    grossCommission !== null
      ? grossCommission -
        referralFeeAmount -
        brokerageSplitAmount -
        marketingCostAllocated
      : null;

  const row = await prisma.transactionFinancials.upsert({
    where: { transactionId: id },
    update: {
      salePrice,
      commissionPercent: asNum(body.commissionPercent),
      grossCommission,
      referralFeePercent: asNum(body.referralFeePercent),
      referralFeeAmount: referralFeeAmount || null,
      brokerageSplitPercent: asNum(body.brokerageSplitPercent),
      brokerageSplitAmount: brokerageSplitAmount || null,
      marketingCostAllocated: marketingCostAllocated || null,
      netCommission,
    },
    create: {
      transactionId: id,
      salePrice,
      commissionPercent: asNum(body.commissionPercent),
      grossCommission,
      referralFeePercent: asNum(body.referralFeePercent),
      referralFeeAmount: referralFeeAmount || null,
      brokerageSplitPercent: asNum(body.brokerageSplitPercent),
      brokerageSplitAmount: brokerageSplitAmount || null,
      marketingCostAllocated: marketingCostAllocated || null,
      netCommission,
    },
  });

  try {
    const audit = new AutomationAuditService(prisma);
    await audit.logAction({
      accountId: actor.accountId,
      transactionId: id,
      entityType: "transaction_financials",
      entityId: row.id,
      ruleName: "manual_financials_edit",
      actionType: previous ? "update" : "create",
      sourceType: "manual",
      confidenceScore: 1.0,
      decision: "applied",
      beforeJson: previous
        ? {
            salePrice: previous.salePrice,
            grossCommission: previous.grossCommission,
            netCommission: previous.netCommission,
          }
        : null,
      afterJson: {
        salePrice: row.salePrice,
        grossCommission: row.grossCommission,
        netCommission: row.netCommission,
      },
      actorUserId: actor.userId,
    });
  } catch {
    // never block the save on audit failure
  }

  return NextResponse.json({ ok: true, financials: row });
}
