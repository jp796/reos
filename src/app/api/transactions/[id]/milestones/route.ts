/**
 * GET  /api/transactions/:id/milestones — list (sorted by dueAt)
 * POST /api/transactions/:id/milestones — create
 *
 * Body for create: { type, label, dueAt (ISO), ownerRole? }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const OWNER_ROLES = new Set([
  "agent",
  "lender",
  "title",
  "inspector",
  "client",
  "coagent",
]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const rows = await prisma.milestone.findMany({
    where: { transactionId: id },
    orderBy: { dueAt: "asc" },
  });
  return NextResponse.json({ items: rows });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    type?: string;
    label?: string;
    dueAt?: string;
    ownerRole?: string;
  } | null;
  if (!body?.label || !body.dueAt) {
    return NextResponse.json(
      { error: "label + dueAt required" },
      { status: 400 },
    );
  }
  const due = new Date(body.dueAt);
  if (Number.isNaN(due.getTime())) {
    return NextResponse.json({ error: "invalid dueAt" }, { status: 400 });
  }
  const ownerRole =
    body.ownerRole && OWNER_ROLES.has(body.ownerRole) ? body.ownerRole : "agent";
  const created = await prisma.milestone.create({
    data: {
      transactionId: id,
      type: body.type?.slice(0, 40) ?? "custom",
      label: body.label.slice(0, 120),
      dueAt: due,
      ownerRole,
      source: "manual",
      confidenceScore: 1.0,
    },
  });
  return NextResponse.json({ ok: true, milestone: created });
}
