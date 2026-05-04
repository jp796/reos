/**
 * DELETE /api/transactions/:id
 *
 * Hard-deletes a transaction and every dependent row (milestones,
 * documents, financials, calendar events, etc. — all `onDelete:
 * Cascade` in schema.prisma). Owner / coordinator only.
 *
 * Auth scope: caller must own the same account as the transaction.
 * We never delete across tenants, even if the caller spoofs the id.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  // Coordinators + owners can delete; agents/assistants cannot.
  if (actor.role !== "owner" && actor.role !== "coordinator") {
    return NextResponse.json(
      { error: "only owner or coordinator can delete transactions" },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true, propertyAddress: true },
  });
  if (!txn) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (txn.accountId !== actor.accountId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await prisma.transaction.delete({ where: { id: txn.id } });
  } catch (e) {
    logError(e, {
      route: "DELETE /api/transactions/[id]",
      accountId: actor.accountId,
      userId: actor.userId,
      transactionId: id,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "delete failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, deleted: txn.id });
}
