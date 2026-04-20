/**
 * POST /api/transactions/:id/contract/discard
 *
 * Drop the pending contract extraction without applying. Used when
 * the upload was wrong, OCR was too unreliable, or the user wants
 * to redo it.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.transaction.update({
    where: { id },
    data: { pendingContractJson: Prisma.DbNull },
  });
  return NextResponse.json({ ok: true });
}
