/**
 * PATCH  /api/transactions/:id/participants/:pid
 *   Body: { role?, notes?, move? }
 *   Edit an existing participant's role / notes, or reorder them
 *   relative to peers in the same role (move: "up" | "down").
 *   Reorder works by nudging createdAt by ±1ms past the neighbor —
 *   no schema change needed, and `orderBy: createdAt asc` (used by
 *   the page) reflects the new order on the next refresh.
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
    move?: "up" | "down";
  } | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  // Reorder relative to a peer of the same role.
  if (body.move === "up" || body.move === "down") {
    const peers = await prisma.transactionParticipant.findMany({
      where: { transactionId: id, role: existing.role },
      orderBy: { createdAt: "asc" },
    });
    const idx = peers.findIndex((p) => p.id === pid);
    const neighborIdx = body.move === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || neighborIdx < 0 || neighborIdx >= peers.length) {
      return NextResponse.json({ ok: true, noop: true });
    }
    const neighbor = peers[neighborIdx];
    if (!neighbor) {
      return NextResponse.json({ ok: true, noop: true });
    }
    const nudgeMs = body.move === "up" ? -1 : 1;
    const newCreatedAt = new Date(neighbor.createdAt.getTime() + nudgeMs);
    const updated = await prisma.transactionParticipant.update({
      where: { id: pid },
      data: { createdAt: newCreatedAt },
      include: { contact: true },
    });
    return NextResponse.json({ ok: true, participant: updated });
  }

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
