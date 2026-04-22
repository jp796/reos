/**
 * POST /api/team/:id/role
 * Body: { role: "owner" | "coordinator" }
 *
 * Owner-only. Changes another user's role within the same account.
 *
 * Guardrails:
 *   - Must be the account owner
 *   - Can't demote yourself (would lock the account)
 *   - Target must be in the same account (404 otherwise — not 403,
 *     to avoid confirming existence)
 *   - Role must be in the known enum
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner, assertSameAccount } from "@/lib/require-session";

const VALID = new Set(["owner", "coordinator"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  if (id === actor.userId) {
    return NextResponse.json(
      { error: "can't change your own role" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as { role?: string } | null;
  if (!body?.role || !VALID.has(body.role)) {
    return NextResponse.json(
      { error: `role must be one of: ${[...VALID].join(", ")}` },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, accountId: true, role: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const acctGuard = assertSameAccount(actor, target.accountId);
  if (acctGuard) return acctGuard;

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { role: body.role },
    select: { id: true, role: true, email: true },
  });

  // Stamp the change so it's auditable
  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: actor.accountId,
        entityType: "user",
        entityId: target.id,
        ruleName: "role_change",
        actionType: "update",
        sourceType: "manual",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: { role: target.role, email: target.email },
        afterJson: { role: updated.role, email: updated.email },
        actorUserId: actor.userId,
      },
    });
  } catch {
    // never block the update on audit failure
  }

  return NextResponse.json({ ok: true, user: updated });
}
