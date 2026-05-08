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

  // Anti-overwrite guard: stamp manuallyEditedAt so AI re-extraction
  // paths (rescan, contract re-upload) know this row has had a human
  // touch them and queue changes for review instead of silently
  // rewriting.
  const updated = await prisma.transaction.update({
    where: { id },
    data: { ...data, manuallyEditedAt: new Date() },
  });

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
