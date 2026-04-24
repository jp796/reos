/**
 * POST /api/leads/:id/promote
 *
 * Turn a LeadIntake row into a real Contact + Transaction:
 *   - Create (or reuse existing) Contact by email/phone match
 *   - Create an "active" Transaction assigned to the acting user
 *   - Side = lead.side; transactionType = buyer/seller mirror
 *   - Seed property address from lead.propertyAddress if present
 *   - Stamp LeadIntake.convertedAt + convertedContactId +
 *     convertedTransactionId + status="converted"
 *
 * Idempotent — if already converted, returns the existing linkage.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const lead = await prisma.leadIntake.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, lead.accountId);
  if (acctGuard) return acctGuard;

  // Already converted — return the existing linkage idempotently
  if (lead.convertedTransactionId && lead.convertedContactId) {
    return NextResponse.json({
      ok: true,
      alreadyConverted: true,
      contactId: lead.convertedContactId,
      transactionId: lead.convertedTransactionId,
    });
  }

  // Reuse contact if email / phone already matches one in account
  let contact = null;
  if (lead.email) {
    contact = await prisma.contact.findFirst({
      where: {
        accountId: lead.accountId,
        primaryEmail: { equals: lead.email, mode: "insensitive" },
      },
    });
  }
  if (!contact && lead.phone) {
    contact = await prisma.contact.findFirst({
      where: { accountId: lead.accountId, primaryPhone: lead.phone },
    });
  }
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        accountId: lead.accountId,
        fullName: lead.fullName,
        primaryEmail: lead.email,
        primaryPhone: lead.phone,
        sourceName: lead.source ?? "Intake form",
      },
    });
  }

  const transactionType = lead.side === "buy" ? "buyer" : "seller";
  const txn = await prisma.transaction.create({
    data: {
      accountId: lead.accountId,
      contactId: contact.id,
      propertyAddress: lead.propertyAddress?.slice(0, 240) ?? null,
      transactionType,
      side: lead.side,
      status: "active",
      assignedUserId: actor.userId,
      rawSourceJson: {
        origin: "lead_intake",
        leadIntakeId: lead.id,
        areaOfInterest: lead.areaOfInterest,
        budget: lead.budget,
        timeline: lead.timeline,
        financingStatus: lead.financingStatus,
        leadNotes: lead.notes,
      },
    },
  });

  await prisma.leadIntake.update({
    where: { id },
    data: {
      status: "converted",
      convertedTransactionId: txn.id,
      convertedContactId: contact.id,
      convertedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    contactId: contact.id,
    transactionId: txn.id,
  });
}
