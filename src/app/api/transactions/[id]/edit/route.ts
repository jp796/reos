/**
 * PATCH /api/transactions/:id/edit
 *
 * Edit top-level transaction metadata: property address, city, state,
 * zip, side (buy/sell/both — aka Representation), transaction type,
 * display-name contact swap.
 * Lighter than status/financials edits — no cascades, no milestones.
 *
 * `side` = representation. "buy" = we represent the buyer, "sell" =
 * we represent the seller, "both" = dual agency (we represent both
 * parties). The financials form uses this to interpret the commission
 * % — under dual, it's the combined buy + sell side rate.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import { recomputeOnDateShift } from "@/services/core/MilestoneRecomputeService";
import { parseInputDate } from "@/lib/dates";
import { recordCorrection } from "@/services/core/ExtractionLearningService";

const VALID_SIDES = new Set(["buy", "sell", "both"]);
const VALID_TYPES = new Set(["buyer", "seller", "investor", "wholesale", "other"]);

interface Body {
  propertyAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  side?: string | null;
  transactionType?: string;
  primaryContactId?: string; // swap the lead contact
  /** null = unassign, string = User.id in the same account */
  assignedUserId?: string | null;
  closingDate?: string | null;
  contractDate?: string | null;
  excludeFromProduction?: boolean;
  /** Rezen transaction UUID pasted from the Bolt URL. null clears. */
  rezenTransactionId?: string | null;
  /** Co-op (other-side) agent + title company contact — the system-of-record
   *  fields, user-editable so a wrong auto-fill can be corrected. */
  coAgentName?: string | null;
  coAgentBrokerage?: string | null;
  coAgentPhone?: string | null;
  coAgentEmail?: string | null;
  coAgentLicense?: string | null;
  titleCompanyName?: string | null;
  titleCompanyContact?: string | null;
  titleCompanyPhone?: string | null;
  titleCompanyEmail?: string | null;
}

/** Trim a free-text field to null-or-capped-string. */
function clip(v: string | null | undefined, max: number): string | null {
  const t = v?.trim();
  return t && t.length > 0 ? t.slice(0, max) : null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const data: Prisma.TransactionUpdateInput = {};

  if (body.propertyAddress !== undefined) {
    const v = body.propertyAddress?.trim();
    data.propertyAddress = v && v.length > 0 ? v.slice(0, 240) : null;
  }
  if (body.city !== undefined) {
    data.city = body.city?.trim()?.slice(0, 80) || null;
  }
  if (body.state !== undefined) {
    data.state = body.state?.trim()?.slice(0, 8) || null;
  }
  if (body.zip !== undefined) {
    data.zip = body.zip?.trim()?.slice(0, 12) || null;
  }
  if (body.side !== undefined) {
    if (body.side !== null && !VALID_SIDES.has(body.side)) {
      return NextResponse.json({ error: "invalid side" }, { status: 400 });
    }
    data.side = body.side || null;
  }
  if (body.transactionType !== undefined) {
    if (!VALID_TYPES.has(body.transactionType)) {
      return NextResponse.json(
        { error: `transactionType must be one of: ${[...VALID_TYPES].join(", ")}` },
        { status: 400 },
      );
    }
    data.transactionType = body.transactionType;
  }
  // Co-op agent + title company contact fields (user corrections override auto-fill).
  if (body.coAgentName !== undefined) data.coAgentName = clip(body.coAgentName, 160);
  if (body.coAgentBrokerage !== undefined) data.coAgentBrokerage = clip(body.coAgentBrokerage, 160);
  if (body.coAgentPhone !== undefined) data.coAgentPhone = clip(body.coAgentPhone, 40);
  if (body.coAgentEmail !== undefined) data.coAgentEmail = clip(body.coAgentEmail, 160);
  if (body.coAgentLicense !== undefined) data.coAgentLicense = clip(body.coAgentLicense, 60);
  if (body.titleCompanyName !== undefined) data.titleCompanyName = clip(body.titleCompanyName, 160);
  if (body.titleCompanyContact !== undefined) data.titleCompanyContact = clip(body.titleCompanyContact, 160);
  if (body.titleCompanyPhone !== undefined) data.titleCompanyPhone = clip(body.titleCompanyPhone, 40);
  if (body.titleCompanyEmail !== undefined) data.titleCompanyEmail = clip(body.titleCompanyEmail, 160);
  if (body.primaryContactId !== undefined) {
    const contact = await prisma.contact.findUnique({
      where: { id: body.primaryContactId },
    });
    if (!contact) {
      return NextResponse.json({ error: "contact not found" }, { status: 404 });
    }
    data.contact = { connect: { id: contact.id } };
  }
  if (body.assignedUserId !== undefined) {
    if (body.assignedUserId === null) {
      data.assignedUser = { disconnect: true };
    } else {
      // Must be a user in the same account
      const user = await prisma.user.findUnique({
        where: { id: body.assignedUserId },
        select: { id: true, accountId: true },
      });
      if (!user || user.accountId !== actor.accountId) {
        return NextResponse.json(
          { error: "assigned user not found in your account" },
          { status: 404 },
        );
      }
      data.assignedUser = { connect: { id: user.id } };
    }
  }
  if (body.closingDate !== undefined) {
    data.closingDate = body.closingDate ? parseInputDate(body.closingDate) ?? new Date() : null;
  }
  if (body.contractDate !== undefined) {
    data.contractDate = body.contractDate ? parseInputDate(body.contractDate) ?? new Date() : null;
  }
  if (body.excludeFromProduction !== undefined) {
    data.excludeFromProduction = body.excludeFromProduction;
  }
  if (body.rezenTransactionId !== undefined) {
    const v = body.rezenTransactionId?.trim();
    // Accept a bare UUID or a full Bolt URL — extract the UUID.
    const uuid = v?.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )?.[0];
    data.rezenTransactionId = v ? (uuid ?? v) : null;
  }

  // Anti-overwrite guard: stamp manuallyEditedAt so AI re-extraction
  // paths (rescan, contract re-upload) know this row has had a human
  // touch them and queue changes for review instead of silently
  // rewriting.
  const updated = await prisma.transaction.update({
    where: { id },
    data: { ...data, manuallyEditedAt: new Date() },
  });

  // Representation flip buyer↔seller must INVERT the parties, not just
  // relabel the side — otherwise the buyer keeps showing as the buyer while
  // the header calls the deal a sell, combining the two sides. Swap every
  // co_buyer↔co_seller so the whole assignment follows the flip. 3-step via
  // a temp role to dodge the (transactionId, contactId, role) unique key.
  if (
    body.side !== undefined &&
    txn.side &&
    updated.side &&
    txn.side !== updated.side &&
    (txn.side === "buy" || txn.side === "sell") &&
    (updated.side === "buy" || updated.side === "sell")
  ) {
    await prisma.$transaction([
      prisma.transactionParticipant.updateMany({
        where: { transactionId: id, role: "co_buyer" },
        data: { role: "_swap_tmp" },
      }),
      prisma.transactionParticipant.updateMany({
        where: { transactionId: id, role: "co_seller" },
        data: { role: "co_buyer" },
      }),
      prisma.transactionParticipant.updateMany({
        where: { transactionId: id, role: "_swap_tmp" },
        data: { role: "co_seller" },
      }),
    ]);
  }

  // Date-shift cascade: when contractDate or closingDate changed,
  // re-derive walkthrough + earnest-money + linked milestones.
  if (body.contractDate !== undefined || body.closingDate !== undefined) {
    try {
      await recomputeOnDateShift(prisma, id, {
        contractDate:
          body.contractDate !== undefined
            ? body.contractDate
              ? parseInputDate(body.contractDate) ?? new Date()
              : null
            : undefined,
        closingDate:
          body.closingDate !== undefined
            ? body.closingDate
              ? parseInputDate(body.closingDate) ?? new Date()
              : null
            : undefined,
      });
    } catch {
      // recompute failure should not block the primary edit
    }
  }

  // Layer 2 — learn from this correction. A human changing the side/type on a
  // deal that has a contract is a labeled extraction correction; if the same
  // fix recurs for a state it promotes to a rule injected into future reads.
  if (body.side !== undefined && txn.side && updated.side && txn.side !== updated.side) {
    void recordCorrection(prisma, {
      accountId: actor.accountId,
      state: updated.state ?? txn.state,
      field: "side",
      extracted: txn.side,
      corrected: updated.side,
    });
  }
  if (body.transactionType !== undefined && txn.transactionType !== updated.transactionType) {
    void recordCorrection(prisma, {
      accountId: actor.accountId,
      state: updated.state ?? txn.state,
      field: "side",
      extracted: txn.transactionType,
      corrected: updated.transactionType,
    });
  }

  // Audit: who edited what
  try {
    const audit = new AutomationAuditService(prisma);
    await audit.logAction({
      accountId: actor.accountId,
      transactionId: id,
      entityType: "transaction",
      entityId: id,
      ruleName: "manual_edit",
      actionType: "update",
      sourceType: "manual",
      confidenceScore: 1.0,
      decision: "applied",
      beforeJson: {
        propertyAddress: txn.propertyAddress,
        city: txn.city,
        state: txn.state,
        zip: txn.zip,
        side: txn.side,
        transactionType: txn.transactionType,
      },
      afterJson: {
        propertyAddress: updated.propertyAddress,
        city: updated.city,
        state: updated.state,
        zip: updated.zip,
        side: updated.side,
        transactionType: updated.transactionType,
      },
      actorUserId: actor.userId,
    });
  } catch {
    // never block the edit on audit failure
  }

  return NextResponse.json({ ok: true, transaction: updated });
}
