/**
 * PATCH /api/transactions/:id/visibility — toggle a deal's per-deal
 * privacy (restrictedToAssignee). Owner/admin only — it's an access
 * decision, not routine editing. Tenancy-guarded.
 *
 * Body: { restrictedToAssignee: boolean }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { canToggleRestriction } from "@/lib/deal-visibility";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (!canToggleRestriction(actor.role)) {
    return NextResponse.json(
      { error: "forbidden", message: "Only an owner/admin can change deal visibility." },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!txn) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as
    | { restrictedToAssignee?: unknown }
    | null;
  if (typeof body?.restrictedToAssignee !== "boolean") {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be { restrictedToAssignee: boolean }." },
      { status: 400 },
    );
  }

  await prisma.transaction.update({
    where: { id: txn.id },
    data: { restrictedToAssignee: body.restrictedToAssignee },
  });
  return NextResponse.json({ ok: true, restrictedToAssignee: body.restrictedToAssignee });
}
