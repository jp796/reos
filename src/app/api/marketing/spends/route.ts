/**
 * GET  /api/marketing/spends   — list all spends (newest first, joined w/ channel)
 * POST /api/marketing/spends   — create a spend entry
 *
 * Body: { sourceChannelId, spendDate (ISO date), amount (float), notes? }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export async function GET() {
  // SECURITY: was listing all spends across all accounts. Scoped to
  // caller now.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const spends = await prisma.marketingSpend.findMany({
    where: { accountId: actor.accountId },
    orderBy: { spendDate: "desc" },
    include: { sourceChannel: { select: { name: true, category: true } } },
    take: 200,
  });
  return NextResponse.json({
    items: spends.map((s) => ({
      id: s.id,
      spendDate: s.spendDate.toISOString(),
      amount: s.amount,
      notes: s.notes,
      sourceChannelId: s.sourceChannelId,
      sourceName: s.sourceChannel.name,
      sourceCategory: s.sourceChannel.category,
    })),
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as {
    sourceChannelId?: string;
    spendDate?: string;
    amount?: number;
    notes?: string;
  } | null;

  if (!body?.sourceChannelId || !body.spendDate || !body.amount) {
    return NextResponse.json(
      { error: "sourceChannelId, spendDate, amount required" },
      { status: 400 },
    );
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be > 0" },
      { status: 400 },
    );
  }
  const date = new Date(body.spendDate);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "invalid spendDate" }, { status: 400 });
  }

  const channel = await prisma.sourceChannel.findUnique({
    where: { id: body.sourceChannelId },
    select: { id: true, accountId: true },
  });
  if (!channel) {
    return NextResponse.json(
      { error: "sourceChannel not found" },
      { status: 404 },
    );
  }
  // SECURITY: prevent cross-tenant writes — only the channel's owning
  // account can record spend against it. Previously we inherited
  // channel.accountId blindly which let a caller write into another
  // tenant's spend ledger by passing that tenant's channel id.
  if (channel.accountId !== actor.accountId) {
    return NextResponse.json(
      { error: "sourceChannel not in caller's account" },
      { status: 403 },
    );
  }

  const created = await prisma.marketingSpend.create({
    data: {
      accountId: actor.accountId,
      sourceChannelId: channel.id,
      spendDate: date,
      amount,
      notes: body.notes?.slice(0, 1000) ?? null,
    },
  });

  return NextResponse.json({ ok: true, id: created.id });
}
