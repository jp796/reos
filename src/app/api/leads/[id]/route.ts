/**
 * PATCH  /api/leads/:id       — update status (new/contacted/dismissed)
 * POST   /api/leads/:id/promote — create a Contact + Transaction from
 *                                 the lead, mark status=converted.
 *
 * NOT a DELETE — intake history is an audit surface, we don't wipe
 * rows. Dismissed leads hide from the default view but stay queryable.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";

const VALID_STATUSES = new Set(["new", "contacted", "converted", "dismissed"]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const existing = await prisma.leadIntake.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, existing.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as { status?: string } | null;
  if (!body?.status || !VALID_STATUSES.has(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...VALID_STATUSES].join(", ")}` },
      { status: 400 },
    );
  }

  const updated = await prisma.leadIntake.update({
    where: { id },
    data: { status: body.status },
  });
  return NextResponse.json({ ok: true, lead: updated });
}
