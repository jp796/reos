/**
 * PATCH /api/flip-analysis/[id]  — link an analysis to a transaction (or unlink).
 * Used when an underwriting candidate is converted into a real deal.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const patch = z.object({ transactionId: z.string().trim().nullable() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;

  const analysis = await prisma.flipAnalysis.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!analysis) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: z.infer<typeof patch>;
  try {
    body = patch.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }

  // A linked transaction must belong to this account too.
  if (body.transactionId) {
    const txn = await prisma.transaction.findFirst({
      where: { id: body.transactionId, accountId: actor.accountId },
      select: { id: true },
    });
    if (!txn) return NextResponse.json({ error: "unknown transaction" }, { status: 400 });
  }

  try {
    await prisma.flipAnalysis.update({ where: { id }, data: { transactionId: body.transactionId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError(e, { route: "PATCH /api/flip-analysis/[id]", accountId: actor.accountId });
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  const analysis = await prisma.flipAnalysis.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!analysis) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    await prisma.flipAnalysis.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError(e, { route: "DELETE /api/flip-analysis/[id]", accountId: actor.accountId });
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
