/**
 * GET /api/transactions/:id/compliance-prep
 *
 * Returns the Rezen compliance-prep report: every required slot,
 * which REOS document fills it (if any), the suggested Rezen
 * filename, and an overall coverage %.
 *
 * Pure read endpoint — no writes. Safe to poll from the UI.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import {
  buildRezenPrepReport,
  loadSlotsForProfile,
} from "@/services/core/RezenCompliancePrep";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: {
      id: true,
      accountId: true,
      side: true,
      state: true,
      account: { select: { brokerageProfileId: true } },
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  // Load the active brokerage's slot lists from DB (falls back to
  // hard-coded Real-Broker lists when no profile is attached).
  const profileId = txn.account.brokerageProfileId;
  const [transactionSlots, listingSlots] = await Promise.all([
    loadSlotsForProfile(prisma, profileId, "transaction", txn.state),
    loadSlotsForProfile(prisma, profileId, "listing", txn.state),
  ]);

  const documents = await prisma.document.findMany({
    where: { transactionId: id },
    select: {
      id: true,
      fileName: true,
      category: true,
      extractedText: true,
      source: true,
      suggestedRezenSlot: true,
      suggestedRezenConfidence: true,
    },
  });

  // Dual agency = render BOTH checklists. Single-side defaults to
  // matching kind, but the user can also flip to either checklist
  // via the panel; we always return both when the side calls for it.
  const showTransaction = txn.side !== "sell"; // buy / both / null
  const showListing = txn.side === "sell" || txn.side === "both";

  const transaction = showTransaction
    ? buildRezenPrepReport({
        side: txn.side,
        documents,
        kind: "transaction",
        slots: transactionSlots,
      })
    : null;
  const listing = showListing
    ? buildRezenPrepReport({
        side: txn.side,
        documents,
        kind: "listing",
        slots: listingSlots,
      })
    : null;

  return NextResponse.json({ transaction, listing });
}
