/**
 * PATCH  /api/transactions/:id/milestones/:mid  — update (date, status, label)
 * DELETE /api/transactions/:id/milestones/:mid  — remove
 *
 * Update body accepts any of: { dueAt, label, completedAt, status, ownerRole }.
 * completedAt: pass ISO string to mark complete, null to un-complete.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const STATUSES = new Set(["pending", "completed", "overdue", "cancelled"]);
const OWNER_ROLES = new Set([
  "agent",
  "lender",
  "title",
  "inspector",
  "client",
  "coagent",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; mid: string }> },
) {
  const { id, mid } = await ctx.params;
  const existing = await prisma.milestone.findFirst({
    where: { id: mid, transactionId: id },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    dueAt?: string | null;
    label?: string;
    completedAt?: string | null;
    status?: string;
    ownerRole?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const data: Prisma.MilestoneUpdateInput = {};
  if (body.dueAt !== undefined) {
    // null = explicitly drop the date (milestone becomes a date-less
    // checklist item). Empty string also clears.
    if (body.dueAt === null || body.dueAt === "") {
      data.dueAt = null;
    } else {
      const d = new Date(body.dueAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "invalid dueAt" }, { status: 400 });
      }
      data.dueAt = d;
    }
  }
  if (body.label !== undefined) data.label = body.label.slice(0, 120);
  if (body.completedAt !== undefined) {
    if (body.completedAt === null) {
      data.completedAt = null;
      if (body.status === undefined) data.status = "pending";
    } else {
      const d = new Date(body.completedAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "invalid completedAt" },
          { status: 400 },
        );
      }
      data.completedAt = d;
      if (body.status === undefined) data.status = "completed";
    }
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    data.status = body.status;
  }
  if (body.ownerRole !== undefined) {
    if (!OWNER_ROLES.has(body.ownerRole)) {
      return NextResponse.json({ error: "invalid ownerRole" }, { status: 400 });
    }
    data.ownerRole = body.ownerRole;
  }

  const updated = await prisma.milestone.update({
    where: { id: mid },
    data,
  });
  return NextResponse.json({ ok: true, milestone: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; mid: string }> },
) {
  const { id, mid } = await ctx.params;
  const existing = await prisma.milestone.findFirst({
    where: { id: mid, transactionId: id },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.milestone.delete({ where: { id: mid } });
  return NextResponse.json({ ok: true });
}
