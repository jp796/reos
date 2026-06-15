/**
 * POST /api/assets/recurring/generate — generate this month's recurring
 * task set for every Asset in the account that sits in a recurring stage
 * (Rental Under-Management, Creative Loan-Servicing — spec §7). Idempotent
 * per month. Intended to be called by the morning tick / a scheduler, but
 * also safe to trigger manually.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { generateRecurringTasks } from "@/services/core/StageEngine";
import { isRecurringStage } from "@/services/core/strategyTemplates";
import type { Strategy } from "@/services/core/DealClassifierService";

export const runtime = "nodejs";

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  // Only strategies with recurring stages can qualify.
  const assets = await prisma.asset.findMany({
    where: {
      accountId: actor.accountId,
      strategy: { in: ["rental_brrrr", "creative"] },
      currentStageName: { not: null },
    },
    select: { id: true, strategy: true, currentStageName: true },
  });

  let totalGenerated = 0;
  let assetsTouched = 0;
  for (const a of assets) {
    if (!isRecurringStage(a.strategy as Strategy, a.currentStageName)) continue;
    const r = await generateRecurringTasks(prisma, { assetId: a.id });
    if (r.generated > 0) {
      totalGenerated += r.generated;
      assetsTouched++;
    }
  }

  return NextResponse.json({
    ok: true,
    assetsConsidered: assets.length,
    assetsTouched,
    totalGenerated,
  });
}
