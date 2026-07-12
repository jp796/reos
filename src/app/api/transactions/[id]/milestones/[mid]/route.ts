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
import { MILESTONE_TYPE_TO_TXN_FIELD } from "@/lib/milestone-fields";
import { logWorkflowEvent } from "@/lib/instrumentation";
import { classifyMilestone } from "@/lib/risk";

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
    // checklist item). Empty string also clears. parseInputDate
    // makes "YYYY-MM-DD" land at local noon so the display stays on
    // the day the user typed in any timezone.
    if (body.dueAt === null || body.dueAt === "") {
      data.dueAt = null;
    } else {
      const { parseInputDate } = await import("@/lib/dates");
      const d = parseInputDate(body.dueAt);
      if (!d) {
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

  // Keep the mirrored Transaction date column in sync so the header,
  // Details tab, Today, and calendar sync all reflect a timeline edit.
  // Only when the date itself changed and this milestone type maps to a
  // Transaction field.
  if (body.dueAt !== undefined) {
    const field = MILESTONE_TYPE_TO_TXN_FIELD[existing.type];
    if (field) {
      await prisma.transaction.update({
        where: { id },
        data: { [field]: data.dueAt ?? null } as Prisma.TransactionUpdateInput,
      });
    }
  }

  // Funnel: a genuine deal risk was cleared. Fire ONLY on the transition
  // into completed (was open → now complete) so repeated PATCHes don't
  // create duplicate funnel events, and only for harm-class milestones
  // (contractual / closing / compliance) — completing an operational
  // checklist item isn't "risk resolved".
  const justCompleted =
    existing.completedAt === null && data.completedAt instanceof Date;
  if (justCompleted) {
    const cat = classifyMilestone(existing.type, existing.label);
    if (
      cat === "contractual_deadline" ||
      cat === "closing_blocker" ||
      cat === "compliance_blocker"
    ) {
      const txn = await prisma.transaction.findUnique({
        where: { id },
        select: { accountId: true },
      });
      if (txn) {
        await logWorkflowEvent(prisma, {
          accountId: txn.accountId,
          transactionId: id,
          event: "risk_resolved",
          meta: { milestoneType: existing.type, category: cat },
        });
      }
    }
  }

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
