/**
 * POST /api/automation/pending-matches/:id/ignore
 * Marks a pending detection as ignored so it stops appearing in the
 * review queue. No side effects on FUB or Gmail.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const pending = await prisma.pendingEmailMatch.findUnique({ where: { id } });
  if (!pending) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return NextResponse.json(
      { error: `already ${pending.status}` },
      { status: 409 },
    );
  }
  await prisma.pendingEmailMatch.update({
    where: { id },
    data: { status: "ignored", resolvedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
