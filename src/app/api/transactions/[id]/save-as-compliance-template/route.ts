/**
 * POST /api/transactions/:id/save-as-compliance-template
 * Body: { name?: string }
 *
 * Snapshot this deal's effective compliance checklist (its applied
 * template, or the resolved brokerage/default requirements) into a
 * reusable ComplianceTemplate.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import { auditTransactionCompliance } from "@/services/core/ComplianceChecklist";
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
    select: { id: true, side: true, state: true, propertyAddress: true, assignedUserId: true, restrictedToAssignee: true },
  });
  if (!txn || !isDealVisible(actor, txn)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let name = "";
  try {
    name = String(((await req.json()) as { name?: string }).name ?? "").trim();
  } catch {
    /* optional */
  }
  if (!name) {
    name = `${(txn.state || "").toUpperCase()} ${txn.side === "sell" ? "listing" : "buyer"} documents`.trim();
  }

  const audit = await auditTransactionCompliance(prisma, txn.id);
  const rawItems = audit.items.map((it) => ({
    key: it.requirement.key,
    label: it.requirement.label,
    keywords: (it.requirement as { keywords?: string[] }).keywords ?? [it.requirement.label],
    sides: (it.requirement as { sides?: string[] }).sides,
    detail: it.requirement.detail,
  }));
  const items = normalizeComplianceItems(rawItems);
  if (items.length === 0) {
    return NextResponse.json({ error: "No checklist items to save." }, { status: 400 });
  }

  try {
    const row = await prisma.complianceTemplate.create({
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
    logError(e, { route: "POST /api/transactions/[id]/save-as-compliance-template", transactionId: txn.id });
    return NextResponse.json({ error: "couldn't save template" }, { status: 500 });
  }
}
