/**
 * GET  /api/marketing/sources — list source channels
 * POST /api/marketing/sources — create a new channel
 *
 * Body: { name, category }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

const VALID_CATEGORIES = new Set([
  "paid",
  "organic",
  "referral",
  "sphere",
  "direct_mail",
  "youtube",
  "ppc",
  "portal",
  "open_house",
  "repeat_client",
  "other",
]);

export async function GET() {
  // SECURITY: was returning all source channels across every tenant.
  // Scoped to caller now.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const rows = await prisma.sourceChannel.findMany({
    where: { accountId: actor.accountId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true },
  });
  return NextResponse.json({ items: rows });
}

export async function POST(req: NextRequest) {
  // SECURITY: previously the POST used prisma.account.findFirst() to
  // pick *some* account — letting any anonymous caller create source
  // channels under another tenant. Now bound to actor.accountId.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    category?: string;
  } | null;

  if (!body?.name?.trim() || !body.category?.trim()) {
    return NextResponse.json(
      { error: "name and category required" },
      { status: 400 },
    );
  }
  const name = body.name.trim().slice(0, 100);
  const category = body.category.trim();
  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${[...VALID_CATEGORIES].join(", ")}` },
      { status: 400 },
    );
  }

  // Idempotent on name within the caller's account.
  const existing = await prisma.sourceChannel.findFirst({
    where: { accountId: actor.accountId, name },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, created: false });
  }

  const created = await prisma.sourceChannel.create({
    data: {
      accountId: actor.accountId,
      name,
      category,
      isActive: true,
    },
  });
  return NextResponse.json({ ok: true, id: created.id, created: true });
}
