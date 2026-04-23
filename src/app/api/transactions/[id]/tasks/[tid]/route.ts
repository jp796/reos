/**
 * PATCH  /api/transactions/:id/tasks/:tid  — update title / dueAt /
 *   priority / assignedTo / description / completedAt (ISO or null)
 * DELETE /api/transactions/:id/tasks/:tid  — remove
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { requireSession, assertSameAccount } from "@/lib/require-session";

const VALID_ASSIGNEES = new Set([
  "coordinator",
  "agent",
  "client",
  "lender",
  "title",
  "inspector",
]);
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; tid: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id, tid } = await ctx.params;
  const existing = await prisma.task.findFirst({
    where: { id: tid, transactionId: id },
    include: { transaction: { select: { accountId: true } } },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, existing.transaction.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    description?: string | null;
    dueAt?: string | null;
    assignedTo?: string;
    priority?: string;
    completedAt?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const data: Prisma.TaskUpdateInput = {};
  if (body.title !== undefined) data.title = body.title.trim().slice(0, 200);
  if (body.description !== undefined) {
    data.description = body.description?.trim().slice(0, 1000) || null;
  }
  if (body.dueAt !== undefined) {
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
  if (body.assignedTo !== undefined) {
    if (!VALID_ASSIGNEES.has(body.assignedTo)) {
      return NextResponse.json({ error: "invalid assignedTo" }, { status: 400 });
    }
    data.assignedTo = body.assignedTo;
  }
  if (body.priority !== undefined) {
    if (!VALID_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ error: "invalid priority" }, { status: 400 });
    }
    data.priority = body.priority;
  }
  if (body.completedAt !== undefined) {
    if (body.completedAt === null) {
      data.completedAt = null;
    } else {
      const d = new Date(body.completedAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "invalid completedAt" },
          { status: 400 },
        );
      }
      data.completedAt = d;
    }
  }

  const updated = await prisma.task.update({ where: { id: tid }, data });
  return NextResponse.json({ ok: true, task: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; tid: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id, tid } = await ctx.params;
  const existing = await prisma.task.findFirst({
    where: { id: tid, transactionId: id },
    include: { transaction: { select: { accountId: true } } },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, existing.transaction.accountId);
  if (acctGuard) return acctGuard;

  await prisma.task.delete({ where: { id: tid } });
  return NextResponse.json({ ok: true });
}
