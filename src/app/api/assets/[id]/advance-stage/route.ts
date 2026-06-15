/**
 * POST /api/assets/:id/advance-stage — advance an Asset to the next
 * stage of its strategy lifecycle and instantiate that stage's tasks
 * (spec §6, §8.1). When the Asset has no current stage yet, this seeds
 * the first stage. At the final stage it's a no-op (done=true).
 *
 * Tenancy: the Asset must belong to the caller's account.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { advanceStage } from "@/services/core/StageEngine";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  // Tenancy — scope by accountId so a caller can't advance another
  // tenant's deal.
  const asset = await prisma.asset.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!asset) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await advanceStage(prisma, { assetId: asset.id });
  return NextResponse.json({ ok: true, ...result });
}
