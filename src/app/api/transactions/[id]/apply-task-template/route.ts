/**
 * POST /api/transactions/:id/apply-task-template
 * Body: { templateId }
 *
 * Applies a stored TaskTemplate's items to this deal — creating Tasks
 * with due dates derived from the deal's milestones. Deduped by title.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import {
  applyTaskTemplateItems,
  normalizeItems,
} from "@/services/core/UserTaskTemplates";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true, side: true, assignedUserId: true, restrictedToAssignee: true },
  });
  if (!txn || !isDealVisible(actor, txn)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let templateId = "";
  try {
    templateId = String(((await req.json()) as { templateId?: string }).templateId ?? "");
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const tpl = await prisma.taskTemplate.findFirst({
    where: { id: templateId, accountId: actor.accountId },
    select: { itemsJson: true, name: true },
  });
  if (!tpl) return NextResponse.json({ error: "template not found" }, { status: 404 });

  try {
    const items = normalizeItems(tpl.itemsJson);
    const result = await applyTaskTemplateItems(prisma, txn.id, items, txn.side);
    return NextResponse.json({ ok: true, ...result, template: tpl.name });
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/apply-task-template",
      transactionId: txn.id,
    });
    return NextResponse.json({ error: "apply failed" }, { status: 500 });
  }
}
