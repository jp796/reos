/**
 * GET /api/transactions/:id/compliance
 *
 * Returns the compliance audit for a transaction — which required
 * docs are on file vs missing, based on side + state + the keyword
 * matcher in ComplianceChecklist.
 *
 * Pure read-only. Rate-limiting not needed — no external calls.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { auditTransactionCompliance } from "@/services/core/ComplianceChecklist";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const audit = await auditTransactionCompliance(prisma, id);
  return NextResponse.json(audit);
}
