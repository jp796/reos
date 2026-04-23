/**
 * PATCH  /api/transactions/:id/participants/:pid
 *   Body: { role?: string, notes?: string }
 *   Edit an existing participant's role or notes. Useful for
 *   correcting auto-enriched participants whose role the regex
 *   inferrer guessed wrong (almost everyone lands as "other").
 *
 * DELETE /api/transactions/:id/participants/:pid
 *   Remove a participant. Does NOT delete the contact (others may
 *   reference it).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";

const VALID_ROLES = new Set([
  "co_buyer",
  "co_seller",
  "lender",
  "attorney",
  "inspector",
  "coordinator",
  "title",
  "other",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id, pid } = await ctx.params;
  const existing = await prisma.transactionParticipant.findFirst({
    where: { id: pid, transactionId: id },
    include: { transaction: { select: { accountId: true } } },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, existing.transaction.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as {
    role?: string;
    notes?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const data: { role?: string; notes?: string | null } = {};
  if (body.role !== undefined) {
    if (!VALID_ROLES.has(body.role)) {
      return NextResponse.json(
        { error: `role must be one of: ${[...VALID_ROLES].join(", ")}` },
        { status: 400 },
      );
    }
    data.role = body.role;
  }
  if (body.notes !== undefined) {
    data.notes = body.notes?.toString().slice(0, 500) || null;
  }

  const updated = await prisma.transactionParticipant.update({
    where: { id: pid },
    data,
    include: { contact: true },
  });

  return NextResponse.json({ ok: true, participant: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id, pid } = await ctx.params;
  const existing = await prisma.transactionParticipant.findFirst({
    where: { id: pid, transactionId: id },
    include: { transaction: { select: { accountId: true } } },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, existing.transaction.accountId);
  if (acctGuard) return acctGuard;

  await prisma.transactionParticipant.delete({ where: { id: pid } });
  return NextResponse.json({ ok: true });
}
