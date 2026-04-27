/**
 * GET /api/transactions/:id/compliance-prep
 *
 * Returns the Rezen compliance-prep report: every required slot,
 * which REOS document fills it (if any), the suggested Rezen
 * filename, and an overall coverage %.
 *
 * Pure read endpoint — no writes. Safe to poll from the UI.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { buildRezenPrepReport } from "@/services/core/RezenCompliancePrep";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true, side: true, state: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  const documents = await prisma.document.findMany({
    where: { transactionId: id },
    select: {
      id: true,
      fileName: true,
      category: true,
      extractedText: true,
      source: true,
    },
  });

  const report = buildRezenPrepReport({
    side: txn.side,
    state: txn.state,
    documents,
  });

  return NextResponse.json(report);
}
