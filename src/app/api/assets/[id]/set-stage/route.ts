/**
 * POST /api/assets/:id/set-stage — move an Asset to a specific stage
 * (drag-to-column on the kanban board). Body: { stageKey }.
 * Tenancy-guarded; the stage must belong to the Asset's strategy.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { setStage } from "@/services/core/StageEngine";

export const runtime = "nodejs";

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

  const body = (await req.json().catch(() => null)) as { stageKey?: unknown } | null;
  if (typeof body?.stageKey !== "string") {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be { stageKey: string }." },
      { status: 400 },
    );
  }

  const result = await setStage(prisma, { assetId: asset.id, stageKey: body.stageKey });
  if (!result.ok) {
    return NextResponse.json(
      { error: "invalid_stage", message: "That stage isn't valid for this deal's strategy." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ...result });
}
