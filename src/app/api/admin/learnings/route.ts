/**
 * GET /api/admin/learnings
 *
 * Shows what Atlas has learned from this account's corrections (Layer 2):
 * active injectable rules first, then pending corrections still gathering
 * signal. Owner/admin-only, tenant-scoped.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { PROMOTE_THRESHOLD, ruleTextFor } from "@/services/core/ExtractionLearningService";

export async function GET(_req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role && actor.role !== "owner" && actor.role !== "admin") {
    return NextResponse.json({ error: "owner/admin only" }, { status: 403 });
  }

  const rows = await prisma.extractionLearning.findMany({
    where: { accountId: actor.accountId },
    orderBy: [{ active: "desc" }, { weight: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  const active = rows
    .filter((r) => r.active)
    .map((r) => ({
      field: r.field,
      state: r.state,
      docType: r.docType,
      weight: r.weight,
      rule: r.ruleText ?? ruleTextFor(r.field, r.state),
    }));

  const pending = rows
    .filter((r) => !r.active)
    .map((r) => ({
      field: r.field,
      state: r.state,
      weight: r.weight,
      needsMore: Math.max(0, PROMOTE_THRESHOLD - r.weight),
    }));

  return NextResponse.json({
    ok: true,
    threshold: PROMOTE_THRESHOLD,
    activeRules: active.length,
    active,
    pending,
    summary: `${active.length} active rule(s) injected into extraction; ${pending.length} correction pattern(s) still gathering signal.`,
  });
}
