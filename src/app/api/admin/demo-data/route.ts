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
  wipeDemoTransactions,
} from "@/services/seeds/demoDataSeeds";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  const body = (await req.json().catch(() => ({}))) as { count?: number };
  const r = await seedDemoTransactions(prisma, {
    accountId: actor.accountId,
    ownerUserId: actor.userId,
    count: body.count ?? 6,
  });
  return NextResponse.json({ ok: true, ...r });
}

export async function DELETE() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  const r = await wipeDemoTransactions(prisma, actor.accountId);
  return NextResponse.json({ ok: true, ...r });
}
