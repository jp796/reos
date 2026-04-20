/**
 * GET  /api/marketing/sources — list source channels
 * POST /api/marketing/sources — create a new channel
 *
 * Body: { name, category }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

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
  const rows = await prisma.sourceChannel.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true },
  });
  return NextResponse.json({ items: rows });
}

export async function POST(req: NextRequest) {
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

  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "no account" }, { status: 500 });
  }

  // Idempotent on name
  const existing = await prisma.sourceChannel.findFirst({
    where: { accountId: account.id, name },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, created: false });
  }

  const created = await prisma.sourceChannel.create({
    data: {
      accountId: account.id,
      name,
      category,
      isActive: true,
    },
  });
  return NextResponse.json({ ok: true, id: created.id, created: true });
}
