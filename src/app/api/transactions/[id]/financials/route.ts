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
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

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

  return NextResponse.json({ ok: true, financials: row });
}
