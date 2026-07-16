/**
 * POST /api/assets/:id/reclassify
 *
 * Non-destructive strategy reclassification (decision 5): change the deal's
 * workflow type WITHOUT losing any data — tasks, docs, economics, projects,
 * and history are all preserved (unlike the legacy classification-override
 * PATCH, which clears incomplete stage tasks). Audit-logged and reversible by
 * reclassifying back.
 *
 * Body: { strategy: Strategy, titlePath?: TitlePath | null }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { reclassifyStrategy } from "@/services/core/ProjectEngine";
import type { Strategy } from "@/services/core/DealClassifierService";

export const runtime = "nodejs";

const STRATEGIES = new Set(["retail", "flip", "wholetail", "wholesale", "rental_brrrr", "creative"]);
const TITLE_PATHS = new Set(["takes_title", "assignment", "double_close", "contract_rights"]);

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
    strategy?: string;
    titlePath?: string | null;
  } | null;
  if (!body?.strategy || !STRATEGIES.has(body.strategy)) {
    return NextResponse.json({ error: "invalid strategy" }, { status: 400 });
  }
  if (body.titlePath !== undefined && body.titlePath !== null && !TITLE_PATHS.has(body.titlePath)) {
    return NextResponse.json({ error: "invalid titlePath" }, { status: 400 });
  }

  const result = await reclassifyStrategy(prisma, {
    assetId: asset.id,
    newStrategy: body.strategy as Strategy,
    newTitlePath: body.titlePath,
    actorUserId: actor.userId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "reclassify_failed" }, { status: 400 });
  }
  return NextResponse.json(result);
}
