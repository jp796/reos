/**
 * POST   /api/transactions/[id]/funding   — attach a private-money partner + amount
 * DELETE /api/transactions/[id]/funding    — remove a funding link (?fundingId=)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const attach = z.object({
  partnerId: z.string().trim().min(1),
  amount: z.number().nonnegative().nullish(),
  note: z.string().trim().max(500).nullish(),
});

async function ownsTxn(accountId: string, id: string): Promise<boolean> {
  const t = await prisma.transaction.findFirst({ where: { id, accountId }, select: { id: true } });
  return !!t;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  if (!(await ownsTxn(actor.accountId, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: z.infer<typeof attach>;
  try {
    body = attach.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }
  // The partner must belong to this account too (no cross-tenant linking).
  const partner = await prisma.privateMoneyPartner.findFirst({
    where: { id: body.partnerId, accountId: actor.accountId },
    select: { id: true },
  });
  if (!partner) return NextResponse.json({ error: "unknown partner" }, { status: 400 });

  try {
    const item = await prisma.dealFunding.create({
      data: { transactionId: id, partnerId: body.partnerId, amount: body.amount ?? null, note: body.note || null },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    logError(e, { route: "POST /api/transactions/[id]/funding", accountId: actor.accountId });
    return NextResponse.json({ error: "attach failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  if (!(await ownsTxn(actor.accountId, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const fundingId = req.nextUrl.searchParams.get("fundingId");
  if (!fundingId) return NextResponse.json({ error: "fundingId required" }, { status: 400 });
  try {
    // Scope the delete to this transaction so a funding id can't be removed cross-deal.
    await prisma.dealFunding.deleteMany({ where: { id: fundingId, transactionId: id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError(e, { route: "DELETE /api/transactions/[id]/funding", accountId: actor.accountId });
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
