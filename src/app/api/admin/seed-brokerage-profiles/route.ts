/**
 * POST /api/admin/seed-brokerage-profiles
 *
 * Owner-only. Idempotently seeds the BrokerageProfile +
 * BrokerageChecklist tables with the canonical profiles
 * (real-broker + indie-default). Run once after deploy; safe to
 * re-run anytime.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireOwner } from "@/lib/require-session";
import { seedBrokerageProfiles } from "@/services/seeds/seedBrokerageProfiles";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // Allow bearer-secret bypass so the seed can be triggered from CI
  // / one-off scripts without an owner session.
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const scheduledOk =
    !!env.SCAN_SCHEDULE_SECRET && bearer === env.SCAN_SCHEDULE_SECRET;
  if (!scheduledOk) {
    const actor = await requireOwner();
    if (actor instanceof NextResponse) return actor;
  }
  const result = await seedBrokerageProfiles(prisma);
  return NextResponse.json({ ok: true, ...result });
}
