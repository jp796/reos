/**
 * PATCH  /api/email-templates/:id  — update
 * DELETE /api/email-templates/:id  — delete (starter templates allowed — user
 *                                    can always re-seed)
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { requireSession, assertSameAccount } from "@/lib/require-session";

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

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const existing = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, existing.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    subject?: string;
    body?: string;
    category?: string;
    defaultTo?: string[];
    sortOrder?: number;
  } | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const data: Prisma.EmailTemplateUpdateInput = {};
  if (body.name !== undefined) data.name = body.name.trim().slice(0, 150);
  if (body.subject !== undefined) data.subject = body.subject.trim().slice(0, 300);
  if (body.body !== undefined) data.body = body.body.slice(0, 20_000);
  if (body.category !== undefined) {
    if (!VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    data.category = body.category;
  }
  if (body.defaultTo !== undefined) {
    data.defaultTo = Array.isArray(body.defaultTo)
      ? body.defaultTo.slice(0, 10)
      : [];
  }
  if (body.sortOrder !== undefined && typeof body.sortOrder === "number") {
    data.sortOrder = body.sortOrder;
  }

  const updated = await prisma.emailTemplate.update({ where: { id }, data });
  return NextResponse.json({ ok: true, template: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const existing = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, existing.accountId);
  if (acctGuard) return acctGuard;

  await prisma.emailTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
