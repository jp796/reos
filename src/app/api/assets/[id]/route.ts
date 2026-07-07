/**
 * PATCH /api/assets/:id — edit an Asset's classification + hybrid
 * agency component (spec §1, §5). Lets the user OVERRIDE auto-detect
 * (strategy / representation / title path / creative substructure) and
 * record a hybrid principal+commission component (agencyComponent).
 *
 * Changing strategy resets currentStageName to null so the new
 * lifecycle starts fresh (StagePanel shows "Start lifecycle").
 *
 * Tenancy: the Asset must belong to the caller's account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/require-session";
import { applyStrategyTemplate } from "@/services/core/StageEngine";
import { seedCreativeDeadlines } from "@/services/core/creativeDeadlines";

export const runtime = "nodejs";

const STRATEGIES = new Set(["retail", "flip", "wholesale", "rental_brrrr", "creative"]);
const REPRESENTATIONS = new Set(["agency", "principal"]);
const TITLE_PATHS = new Set(["takes_title", "assignment", "double_close", "contract_rights"]);
const SUBSTRUCTURES = new Set(["subject_to", "seller_finance", "lease_option", "wrap"]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const asset = await prisma.asset.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true, strategy: true },
  });
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    representation?: string;
    strategy?: string;
    titlePath?: string | null;
    creativeSubstructure?: string | null;
    agencyComponent?: Record<string, unknown> | null;
  } | null;
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const data: Prisma.AssetUpdateInput = {};

  if (body.representation !== undefined) {
    if (!REPRESENTATIONS.has(body.representation)) {
      return NextResponse.json({ error: "invalid representation" }, { status: 400 });
    }
    data.representation = body.representation;
  }
  if (body.strategy !== undefined) {
    if (!STRATEGIES.has(body.strategy)) {
      return NextResponse.json({ error: "invalid strategy" }, { status: 400 });
    }
    data.strategy = body.strategy;
    // New strategy → restart the lifecycle.
    if (body.strategy !== asset.strategy) data.currentStageName = null;
  }
  if (body.titlePath !== undefined) {
    if (body.titlePath !== null && !TITLE_PATHS.has(body.titlePath)) {
      return NextResponse.json({ error: "invalid titlePath" }, { status: 400 });
    }
    data.titlePath = body.titlePath;
  }
  if (body.creativeSubstructure !== undefined) {
    if (body.creativeSubstructure !== null && !SUBSTRUCTURES.has(body.creativeSubstructure)) {
      return NextResponse.json({ error: "invalid creativeSubstructure" }, { status: 400 });
    }
    data.creativeSubstructure = body.creativeSubstructure;
  }
  if (body.agencyComponent !== undefined) {
    data.agencyComponentJson =
      body.agencyComponent === null
        ? Prisma.JsonNull
        : (body.agencyComponent as Prisma.InputJsonValue);
  }

  const updated = await prisma.asset.update({ where: { id: asset.id }, data });

  // Re-seed the checklist when the deal type OR the creative sub-structure
  // changes. We clear the INCOMPLETE template-seeded stage tasks (so the old
  // strategy's / old sub-structure's checklist doesn't linger), reset the
  // lifecycle, then instantiate stage 1 for the new classification. Completed
  // tasks are preserved as history. Retail has no lifecycle → no-op reseed.
  const strategyChanged =
    body.strategy !== undefined && body.strategy !== asset.strategy;
  const subChanged = body.creativeSubstructure !== undefined;
  let seeded: { applied: boolean; stageKey: string | null; created: number } | null = null;
  if (strategyChanged || subChanged) {
    await prisma.task.deleteMany({
      where: { assetId: updated.id, stageKey: { not: null }, completedAt: null },
    });
    await prisma.asset.update({
      where: { id: updated.id },
      data: { currentStageName: null },
    });
    seeded = await applyStrategyTemplate(prisma, { assetId: updated.id });
    // Creative-finance deals get their sub-structure-specific deadline set
    // seeded onto the timeline as "needs date" milestones (idempotent).
    if (updated.strategy === "creative") {
      await seedCreativeDeadlines(prisma, {
        assetId: updated.id,
        substructure: updated.creativeSubstructure,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    seeded,
    asset: {
      id: updated.id,
      representation: updated.representation,
      strategy: updated.strategy,
      titlePath: updated.titlePath,
      creativeSubstructure: updated.creativeSubstructure,
    },
  });
}
