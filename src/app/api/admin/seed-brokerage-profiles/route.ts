/**
 * POST /api/admin/seed-brokerage-profiles
 *
 * Owner-only. Idempotently seeds the BrokerageProfile +
 * BrokerageChecklist tables with the canonical profiles
 * (real-broker + indie-default). Run once after deploy; safe to
 * re-run anytime.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/require-session";
import { seedBrokerageProfiles } from "@/services/seeds/seedBrokerageProfiles";

export const runtime = "nodejs";

export async function POST() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  const result = await seedBrokerageProfiles(prisma);
  return NextResponse.json({ ok: true, ...result });
}
