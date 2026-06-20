/** DELETE /api/compliance-templates/:id — remove (own account only). */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  const row = await prisma.complianceTemplate.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.complianceTemplate.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
}
