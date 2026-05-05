/**
 * DELETE /api/account/members/:memberId
 *
 * Revokes a membership. Owner only. Sets revokedAt rather than
 * deleting the row so we keep an audit trail of who was ever in the
 * workspace. requireSession's active-account check rejects revoked
 * rows so revocation takes effect on the next request.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ memberId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  const { memberId } = await ctx.params;
  const m = await prisma.accountMembership.findUnique({
    where: { id: memberId },
    select: { accountId: true },
  });
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (m.accountId !== actor.accountId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.accountMembership.update({
    where: { id: memberId },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
