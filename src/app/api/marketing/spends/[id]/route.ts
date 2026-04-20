/**
 * DELETE /api/marketing/spends/:id — remove a spend entry
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const existing = await prisma.marketingSpend.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.marketingSpend.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
