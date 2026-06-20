/**
 * POST /api/transactions/:id/apply-compliance-template
 * Body: { templateId }  (or { clear: true } to revert to brokerage default)
 *
 * Stores the template's items on the deal (complianceTemplateJson) so the
 * compliance audit uses THIS checklist for THIS deal — overriding the
 * brokerage default. Clearing reverts to the account/brokerage resolution.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import { normalizeComplianceItems } from "@/services/core/UserComplianceTemplates";
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
    select: { id: true, assignedUserId: true, restrictedToAssignee: true },
  });
  if (!txn || !isDealVisible(actor, txn)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { templateId?: string; clear?: boolean };
  try {
    body = (await req.json()) as { templateId?: string; clear?: boolean };
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    if (body.clear) {
      await prisma.transaction.update({
        where: { id: txn.id },
        data: { complianceTemplateJson: Prisma.DbNull, complianceTemplateName: null },
      });
      return NextResponse.json({ ok: true, cleared: true });
    }
    const tpl = await prisma.complianceTemplate.findFirst({
      where: { id: body.templateId ?? "", accountId: actor.accountId },
      select: { itemsJson: true, name: true },
    });
    if (!tpl) return NextResponse.json({ error: "template not found" }, { status: 404 });
    const items = normalizeComplianceItems(tpl.itemsJson);
    await prisma.transaction.update({
      where: { id: txn.id },
      data: {
        complianceTemplateJson: items as unknown as Prisma.InputJsonValue,
        complianceTemplateName: tpl.name,
      },
    });
    return NextResponse.json({ ok: true, applied: tpl.name, count: items.length });
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/apply-compliance-template",
      transactionId: txn.id,
    });
    return NextResponse.json({ error: "apply failed" }, { status: 500 });
  }
}
