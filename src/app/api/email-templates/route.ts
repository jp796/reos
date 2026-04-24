/**
 * GET  /api/email-templates         — list this account's templates
 * POST /api/email-templates         — create one
 * POST /api/email-templates?seed=1  — seed the starter set (owner only)
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requireOwner } from "@/lib/require-session";
import { STARTER_TEMPLATES } from "@/services/core/EmailMergeService";

const VALID_CATEGORIES = new Set([
  "welcome",
  "inspection",
  "title",
  "clear_to_close",
  "closing",
  "post_close",
  "review_request",
  "generic",
]);

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const rows = await prisma.emailTemplate.findMany({
    where: { accountId: actor.accountId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ items: rows });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);

  // Seed mode — owner-only, idempotent on isStarter=true rows
  if (url.searchParams.get("seed") === "1") {
    const actor = await requireOwner();
    if (actor instanceof NextResponse) return actor;

    const existing = await prisma.emailTemplate.findMany({
      where: { accountId: actor.accountId, isStarter: true },
      select: { name: true },
    });
    const have = new Set(existing.map((t) => t.name.toLowerCase()));
    let created = 0;
    for (const t of STARTER_TEMPLATES) {
      if (have.has(t.name.toLowerCase())) continue;
      await prisma.emailTemplate.create({
        data: {
          accountId: actor.accountId,
          name: t.name,
          subject: t.subject,
          body: t.body,
          category: t.category,
          defaultTo: t.defaultTo,
          sortOrder: t.sortOrder,
          isStarter: true,
        },
      });
      created++;
    }
    return NextResponse.json({ ok: true, created, skipped: STARTER_TEMPLATES.length - created });
  }

  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    subject?: string;
    body?: string;
    category?: string;
    defaultTo?: string[];
    sortOrder?: number;
  } | null;
  if (!body?.name?.trim() || !body.subject?.trim() || !body.body?.trim()) {
    return NextResponse.json(
      { error: "name, subject, body all required" },
      { status: 400 },
    );
  }
  const category =
    body.category && VALID_CATEGORIES.has(body.category) ? body.category : "generic";

  const created = await prisma.emailTemplate.create({
    data: {
      accountId: actor.accountId,
      name: body.name.trim().slice(0, 150),
      subject: body.subject.trim().slice(0, 300),
      body: body.body.slice(0, 20_000),
      category,
      defaultTo: Array.isArray(body.defaultTo) ? body.defaultTo.slice(0, 10) : [],
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 100,
    },
  });
  return NextResponse.json({ ok: true, template: created });
}
