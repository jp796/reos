/**
 * POST /api/transactions/:id/documents/analyze
 *
 * Runs the document read (synthesizeDeal) for a deal. Split out of the upload
 * path on purpose: uploads now return immediately and the CLIENT fires this in
 * the background, so the user is never staring at a spinner while a model reads
 * a contract. Safe to call repeatedly — synthesizeDeal persists each doc's
 * analysis as it goes, and anything unfinished is picked up by Reconcile.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { synthesizeDeal } from "@/services/core/DocumentSynthesisService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    await synthesizeDeal(prisma, actor.accountId, txn.id, false);
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/documents/analyze",
      transactionId: id,
      accountId: actor.accountId,
    });
    // Non-fatal: the documents are already stored; Reconcile can re-run this.
    return NextResponse.json({ ok: false, error: "analysis failed" }, { status: 200 });
  }
}
