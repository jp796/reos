/**
 * GET  /api/assets/:id/capital — list capital-stack entries.
 * POST /api/assets/:id/capital — add an entry.
 *   Body: { type, principal?, rate?, balloonDate?, payoffBalance?,
 *           lenderContactId?, notes? }
 * Tenancy: the Asset must belong to the caller's account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

const VALID_TYPES = new Set([
  "private_money",
  "bridge",
  "dscr",
  "seller_note",
  "underlying_loan",
]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  const asset = await prisma.asset.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const entries = await prisma.capitalStackEntry.findMany({
    where: { assetId: id },
    orderBy: { createdAt: "asc" },
    include: { lender: { select: { id: true, fullName: true } } },
  });
  return NextResponse.json({ entries });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  const asset = await prisma.asset.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    type?: string;
    principal?: number | null;
    rate?: number | null;
    balloonDate?: string | null;
    payoffBalance?: number | null;
    lenderContactId?: string | null;
    notes?: string | null;
  } | null;
  if (!body?.type || !VALID_TYPES.has(body.type)) {
    return NextResponse.json(
      { error: "bad_request", message: `type must be one of ${[...VALID_TYPES].join(", ")}` },
      { status: 400 },
    );
  }
  const balloon = body.balloonDate ? new Date(body.balloonDate) : null;

  const entry = await prisma.capitalStackEntry.create({
    data: {
      assetId: id,
      accountId: actor.accountId,
      type: body.type,
      principal: body.principal ?? null,
      rate: body.rate ?? null,
      balloonDate: balloon && !Number.isNaN(balloon.getTime()) ? balloon : null,
      payoffBalance: body.payoffBalance ?? null,
      lenderContactId: body.lenderContactId ?? null,
      notes: body.notes?.slice(0, 500) ?? null,
    },
  });
  return NextResponse.json({ ok: true, entry });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const entryId = url.searchParams.get("entryId");
  if (!entryId) {
    return NextResponse.json({ error: "entryId required" }, { status: 400 });
  }
  // Tenancy via the join.
  const entry = await prisma.capitalStackEntry.findFirst({
    where: { id: entryId, assetId: id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.capitalStackEntry.delete({ where: { id: entryId } });
  return NextResponse.json({ ok: true });
}
