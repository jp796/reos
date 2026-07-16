/**
 * POST /api/assets/:id/revert-project
 *
 * Non-destructively reverse a project conversion: archive the active Project
 * (every task, doc, economics record, and audit entry is preserved) and clear
 * the Asset's project-stage pointer so the deal reads as a transaction again.
 * Reversible — re-run /convert-to-project to make a fresh project.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { revertToTransaction } from "@/services/core/ProjectEngine";

export const runtime = "nodejs";

export async function POST(
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

  const result = await revertToTransaction(prisma, { assetId: asset.id, actorUserId: actor.userId });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "revert_failed" }, { status: 400 });
  }
  return NextResponse.json(result);
}
