/**
 * POST /api/transactions/:id/participants/:pid/promote
 *
 * Promote a participant to be the transaction's primary contact.
 * The old primary contact is demoted to a participant in the
 * matching same-side role (co_buyer or co_seller depending on the
 * promoted participant's role). Lets a TC fix cases where the
 * "wrong" contact got attached to the deal during extraction.
 *
 * The promoted participant row is deleted (since they're now the
 * primary on the transaction itself, not a participant).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; pid: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id, pid } = await ctx.params;

  const participant = await prisma.transactionParticipant.findFirst({
    where: { id: pid, transactionId: id },
    include: {
      transaction: { select: { accountId: true, contactId: true, side: true } },
    },
  });
  if (!participant) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const acctGuard = assertSameAccount(actor, participant.transaction.accountId);
  if (acctGuard) return acctGuard;

  const oldPrimaryContactId = participant.transaction.contactId;
  const newPrimaryContactId = participant.contactId;

  if (oldPrimaryContactId === newPrimaryContactId) {
    return NextResponse.json({ ok: true, noop: true });
  }

  // Decide what role the OLD primary should land in. If the promoted
  // participant was a co_seller, the old primary becomes a co_seller
  // too (same side); same logic for co_buyer. For non-side roles
  // (lender/title/etc) we fall back to the transaction's `side` to
  // pick co_buyer or co_seller.
  let demotedRole: string;
  if (participant.role === "co_buyer") demotedRole = "co_buyer";
  else if (participant.role === "co_seller") demotedRole = "co_seller";
  else if (participant.transaction.side === "sell") demotedRole = "co_seller";
  else demotedRole = "co_buyer";

  await prisma.$transaction(async (tx) => {
    // 1. Swap primary on the transaction
    await tx.transaction.update({
      where: { id },
      data: { contactId: newPrimaryContactId },
    });

    // 2. Remove the now-primary participant row (it represents the
    //    same contact, no longer needed as a participant)
    await tx.transactionParticipant.delete({ where: { id: pid } });

    // 3. Add the old primary as a participant in the demoted role —
    //    unless they're already on the participants list in some role.
    const existingForOld = await tx.transactionParticipant.findFirst({
      where: { transactionId: id, contactId: oldPrimaryContactId },
    });
    if (!existingForOld) {
      await tx.transactionParticipant.create({
        data: {
          transactionId: id,
          contactId: oldPrimaryContactId,
          role: demotedRole,
          notes: "Auto-demoted from primary",
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
