import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = await prisma.pendingClosingDateUpdate.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.status !== "pending") {
    return NextResponse.json({ error: `already ${row.status}` }, { status: 409 });
  }
  await prisma.pendingClosingDateUpdate.update({
    where: { id },
    data: { status: "ignored" },
  });
  return NextResponse.json({ ok: true });
}
