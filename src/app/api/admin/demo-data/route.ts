/**
 * POST   /api/admin/demo-data — generate sample transactions
 * DELETE /api/admin/demo-data — wipe everything tagged isDemo=true
 *
 * Owner-only. Demo data is account-scoped.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/require-session";
import {
  seedDemoTransactions,
  seedInvestorDeals,
  wipeDemoTransactions,
} from "@/services/seeds/demoDataSeeds";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  const body = (await req.json().catch(() => ({}))) as { count?: number; investor?: boolean };
  const r = await seedDemoTransactions(prisma, {
    accountId: actor.accountId,
    ownerUserId: actor.userId,
    count: body.count ?? 6,
  });
  // Also seed investor deals (principal Assets across strategies) unless
  // explicitly opted out — Sheri + investor-agents need the investor
  // surfaces populated, not just retail.
  let investor = { created: 0, ids: [] as string[] };
  if (body.investor !== false) {
    investor = await seedInvestorDeals(prisma, {
      accountId: actor.accountId,
      ownerUserId: actor.userId,
    });
  }
  return NextResponse.json({
    ok: true,
    created: r.created + investor.created,
    retail: r.created,
    investor: investor.created,
    ids: [...r.ids, ...investor.ids],
  });
}

export async function DELETE() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  const r = await wipeDemoTransactions(prisma, actor.accountId);
  return NextResponse.json({ ok: true, ...r });
}
