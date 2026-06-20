/**
 * POST /api/transactions/:id/save-as-task-template
 * Body: { name?: string }
 *
 * Snapshot this deal's current tasks into a reusable TaskTemplate —
 * preserving relative timing (a task linked to a milestone is saved as
 * relatesToMilestone + offsetFromMilestoneDays so it re-derives on the
 * next deal). The "smart save" ListedKit shows: build a deal, save it
 * as a template for next time.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import { normalizeItems } from "@/services/core/UserTaskTemplates";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const DAY = 86_400_000;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: {
      id: true,
      side: true,
      state: true,
      propertyAddress: true,
      assignedUserId: true,
      restrictedToAssignee: true,
      tasks: {
        select: {
          title: true,
          description: true,
          assignedTo: true,
          priority: true,
          dueAt: true,
          milestone: { select: { type: true, dueAt: true } },
        },
      },
    },
  });
  if (!txn || !isDealVisible(actor, txn)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (txn.tasks.length === 0) {
    return NextResponse.json({ error: "No tasks on this deal to save." }, { status: 400 });
  }

  let name = "";
  try {
    name = String(((await req.json()) as { name?: string }).name ?? "").trim();
  } catch {
    /* optional */
  }
  if (!name) {
    name = `${(txn.state || "").toUpperCase()} ${txn.side === "sell" ? "listing" : txn.side === "both" ? "dual" : "buyer"} checklist`.trim();
  }

  const rawItems = txn.tasks.map((t) => {
    let relatesToMilestone: string | null = null;
    let offsetFromMilestoneDays: number | null = null;
    if (t.milestone?.type && t.milestone.dueAt && t.dueAt) {
      relatesToMilestone = t.milestone.type;
      // positive = task is BEFORE the milestone (matches apply logic)
      offsetFromMilestoneDays = Math.round(
        (t.milestone.dueAt.getTime() - t.dueAt.getTime()) / DAY,
      );
    }
    return {
      title: t.title,
      description: t.description,
      assignedTo: t.assignedTo ?? "coordinator",
      priority: t.priority,
      relatesToMilestone,
      offsetFromMilestoneDays,
    };
  });
  const items = normalizeItems(rawItems);

  try {
    const row = await prisma.taskTemplate.create({
      data: {
        accountId: actor.accountId,
        name: name.slice(0, 120),
        description: `Saved from ${txn.propertyAddress ?? "a deal"}`,
        source: "manual",
        createdByUserId: actor.userId,
        itemsJson: items as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: row.id, count: items.length, name });
  } catch (e) {
    logError(e, { route: "POST /api/transactions/[id]/save-as-task-template", transactionId: txn.id });
    return NextResponse.json({ error: "couldn't save template" }, { status: 500 });
  }
}
