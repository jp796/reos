/**
 * GET  /api/assets/:id/draws  — list draws + schedule for an Asset.
 * POST /api/assets/:id/draws  — request a new draw.
 *   Body: { milestone: string, amount: number, totalBudget?: number }
 * Tenancy: the Asset must belong to the caller's account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { getOrCreateSchedule, requestDraw } from "@/services/core/DrawEngine";

export const runtime = "nodejs";

async function guardAsset(accountId: string, id: string) {
  return prisma.asset.findFirst({
    where: { id, accountId },
    select: { id: true, accountId: true },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  const asset = await guardAsset(actor.accountId, id);
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const schedule = await prisma.drawSchedule.findFirst({
    where: { assetId: id, status: "active" },
    include: { draws: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({ schedule });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  const asset = await guardAsset(actor.accountId, id);
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    milestone?: string;
    amount?: number;
    totalBudget?: number;
  } | null;
  if (!body?.milestone || typeof body.amount !== "number" || body.amount <= 0) {
    return NextResponse.json(
      { error: "bad_request", message: "milestone + positive amount required" },
      { status: 400 },
    );
  }

  const scheduleId = await getOrCreateSchedule(prisma, {
    assetId: id,
    accountId: actor.accountId,
    totalBudget: body.totalBudget ?? null,
  });
  const draw = await requestDraw(prisma, {
    drawScheduleId: scheduleId,
    assetId: id,
    milestone: body.milestone.slice(0, 120),
    amount: body.amount,
  });
  return NextResponse.json({ ok: true, draw });
}
