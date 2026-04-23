/**
 * GET  /api/transactions/:id/tasks          — list (date-less sort to end)
 * POST /api/transactions/:id/tasks          — create one task
 * POST /api/transactions/:id/tasks?seed=1   — seed from state/side template
 *
 * Create body: { title, description?, dueAt?, assignedTo?, priority?, milestoneId? }
 * Seed body: (none needed; uses txn.side + txn.state)
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { applyChecklist } from "@/services/core/TaskTemplates";

const VALID_ASSIGNEES = new Set([
  "coordinator",
  "agent",
  "client",
  "lender",
  "title",
  "inspector",
]);
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const rows = await prisma.task.findMany({
    where: { transactionId: id },
    orderBy: [
      { completedAt: "asc" }, // open tasks first (null sorts first)
      { dueAt: "asc" },
      { priority: "desc" },
      { createdAt: "asc" },
    ],
  });
  return NextResponse.json({ items: rows });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  // Mode: seed the full checklist for this txn's side + state
  if (url.searchParams.get("seed") === "1") {
    const result = await applyChecklist(prisma, id, {
      side: txn.side,
      state: txn.state,
      source: `manual_seed:${actor.userId}`,
    });
    return NextResponse.json({ ok: true, seeded: true, ...result });
  }

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    description?: string | null;
    dueAt?: string | null;
    assignedTo?: string;
    priority?: string;
    milestoneId?: string | null;
  } | null;
  if (!body?.title?.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  let due: Date | null = null;
  if (body.dueAt) {
    const d = new Date(body.dueAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "invalid dueAt" }, { status: 400 });
    }
    due = d;
  }
  const assignedTo =
    body.assignedTo && VALID_ASSIGNEES.has(body.assignedTo)
      ? body.assignedTo
      : "coordinator";
  const priority =
    body.priority && VALID_PRIORITIES.has(body.priority)
      ? body.priority
      : "normal";

  const created = await prisma.task.create({
    data: {
      transactionId: id,
      milestoneId: body.milestoneId ?? null,
      title: body.title.trim().slice(0, 200),
      description: body.description?.trim()?.slice(0, 1000) || null,
      dueAt: due,
      assignedTo,
      priority,
    },
  });
  return NextResponse.json({ ok: true, task: created });
}
