/**
 * POST /api/assets/:id/convert-to-project
 *
 * One-click / confirmed conversion of an investment deal into its PROJECT
 * phase after the acquisition transaction closes (flip / wholetail /
 * rental_brrrr). Creates the Project + timeline (bounded to the holding
 * window). Idempotent; reversible via /revert-project. No-op for strategies
 * without a project phase (wholesale / double-close / retail / creative).
 *
 * Body (optional): { startDate?: ISO }  — anchor date; defaults to the
 * acquisition transaction's closing date.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { convertToProject } from "@/services/core/ProjectEngine";
import { parseInputDate } from "@/lib/dates";

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

  const body = (await req.json().catch(() => ({}))) as { startDate?: string };
  const startDate = body.startDate ? parseInputDate(body.startDate) ?? undefined : undefined;

  const result = await convertToProject(prisma, {
    assetId: asset.id,
    actorUserId: actor.userId,
    startDate,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "convert_failed" }, { status: 400 });
  }
  return NextResponse.json(result);
}
