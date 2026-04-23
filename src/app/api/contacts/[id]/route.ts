/**
 * PATCH /api/contacts/:id
 * Body: { fullName?, primaryEmail?, primaryPhone? }
 *
 * Edit a contact in place. Because Contact is account-scoped, we
 * assert the actor is on the same account as the contact before
 * allowing the update. Writes propagate anywhere the contact is
 * referenced (Transaction.primaryContact, TransactionParticipant,
 * etc.) — by design. If the user means "use a different entity as
 * the primary contact" they should swap the transaction's
 * `primaryContactId` via PATCH /api/transactions/:id/edit instead.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const existing = await prisma.contact.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, existing.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as {
    fullName?: string;
    primaryEmail?: string | null;
    primaryPhone?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const data: Record<string, string | null> = {};
  if (body.fullName !== undefined) {
    const v = body.fullName.trim();
    if (v.length < 1) {
      return NextResponse.json(
        { error: "fullName can't be empty" },
        { status: 400 },
      );
    }
    data.fullName = v.slice(0, 200);
  }
  if (body.primaryEmail !== undefined) {
    const v = body.primaryEmail?.trim() || null;
    if (v && !v.includes("@")) {
      return NextResponse.json(
        { error: "primaryEmail must be a valid email" },
        { status: 400 },
      );
    }
    data.primaryEmail = v ? v.slice(0, 160) : null;
  }
  if (body.primaryPhone !== undefined) {
    data.primaryPhone = body.primaryPhone?.trim()?.slice(0, 40) || null;
  }

  const updated = await prisma.contact.update({ where: { id }, data });

  // Audit-stamp the rename so we can reconstruct "who renamed what"
  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: actor.accountId,
        entityType: "contact",
        entityId: id,
        ruleName: "manual_contact_edit",
        actionType: "update",
        sourceType: "manual",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: {
          fullName: existing.fullName,
          primaryEmail: existing.primaryEmail,
          primaryPhone: existing.primaryPhone,
        },
        afterJson: {
          fullName: updated.fullName,
          primaryEmail: updated.primaryEmail,
          primaryPhone: updated.primaryPhone,
        },
        actorUserId: actor.userId,
      },
    });
  } catch {
    // audit failure doesn't block the edit
  }

  return NextResponse.json({ ok: true, contact: updated });
}
