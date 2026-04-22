/**
 * DELETE /api/transactions/:id/participants/:pid
 * Remove a participant. Does NOT delete the contact (others might use).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  const { id, pid } = await ctx.params;
  const existing = await prisma.transactionParticipant.findFirst({
    where: { id: pid, transactionId: id },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.transactionParticipant.delete({ where: { id: pid } });
  return NextResponse.json({ ok: true });
}
