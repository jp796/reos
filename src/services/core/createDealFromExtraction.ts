/**
 * createDealFromExtraction — create a deal (contact → Asset → Transaction
 * → milestones → financials → stage seed) from a normalized field bag.
 *
 * Mirrors the creation core of /api/automation/create-from-scan so the
 * Atlas `create_deal` tool (Telegram upload → extract → create) produces
 * IDENTICAL deals to the web upload path. (The route still owns its own
 * copy + the Gmail SmartFolder step; this is the shared creation core for
 * the agent path. TODO: collapse the route onto this once both are proven.)
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { addBusinessDays, defaultWalkthroughForState } from "@/lib/business-days";
import { classifyDeal } from "./DealClassifierService";
import { applyStrategyTemplate } from "./StageEngine";
import { hasStageLifecycle } from "./strategyTemplates";

function toDate(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = parseFloat(v.replace(/[,$\s%]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface DealFields {
  address: string;
  buyerName?: string | null;
  sellerName?: string | null;
  effectiveDate?: string | null;
  closingDate?: string | null;
  possessionDate?: string | null;
  inspectionDeadline?: string | null;
  inspectionObjectionDeadline?: string | null;
  titleCommitmentDeadline?: string | null;
  titleObjectionDeadline?: string | null;
  financingDeadline?: string | null;
  walkthroughDate?: string | null;
  earnestMoneyDueDate?: string | null;
  earnestMoneyAmount?: number | null;
  purchasePrice?: number | null;
  sellerSideCommissionPct?: number | null;
  sellerSideCommissionAmount?: number | null;
  buyerSideCommissionPct?: number | null;
  buyerSideCommissionAmount?: number | null;
  titleCompany?: string | null;
  lenderName?: string | null;
  contractStage?: string | null;
  // classifier signals (optional)
  contractText?: string | null;
  rehabBudget?: boolean;
  resaleIntent?: boolean;
  rentEstimate?: boolean;
  refinanceIntent?: boolean;
  assignmentClause?: boolean;
  cashBuyerDisposition?: boolean;
  twoClosingIntent?: boolean;
  source?: string;
}

export interface CreateDealResult {
  created: boolean;
  transactionId: string;
  assetId: string | null;
  strategy: string;
  representation: string;
  milestonesCreated: number;
  grossCommission: number | null;
}

export async function createDealFromExtraction(
  db: PrismaClient,
  opts: { accountId: string; actingUserId: string },
  fields: DealFields,
): Promise<CreateDealResult> {
  const accountId = opts.accountId;
  const actingUserId = opts.actingUserId;
  const sourceName = fields.source ?? "Contract upload (Atlas)";

  const effectiveDate = toDate(fields.effectiveDate);
  const closingDate = toDate(fields.closingDate);
  const possessionDate = toDate(fields.possessionDate);
  const inspectionDeadline = toDate(fields.inspectionDeadline);
  const inspectionObjectionDeadline = toDate(fields.inspectionObjectionDeadline);
  const titleCommitmentDeadline = toDate(fields.titleCommitmentDeadline);
  const titleObjectionDeadline = toDate(fields.titleObjectionDeadline);
  const financingDeadline = toDate(fields.financingDeadline);

  let walkthroughDate = toDate(fields.walkthroughDate);
  let walkthroughDerived = false;
  if (!walkthroughDate && closingDate) {
    const derived = defaultWalkthroughForState(closingDate, fields.address);
    if (derived) {
      walkthroughDate = derived;
      walkthroughDerived = true;
    }
  }
  let earnestMoneyDueDate = toDate(fields.earnestMoneyDueDate);
  let earnestDueDerived = false;
  if (!earnestMoneyDueDate && effectiveDate) {
    earnestMoneyDueDate = addBusinessDays(effectiveDate, 3);
    earnestDueDerived = true;
  }

  const earnestMoneyAmount = toNum(fields.earnestMoneyAmount);
  const purchasePrice = toNum(fields.purchasePrice);
  const sellerPct = toNum(fields.sellerSideCommissionPct);
  const sellerAmt = toNum(fields.sellerSideCommissionAmount);
  const buyerPct = toNum(fields.buyerSideCommissionPct);
  const buyerAmt = toNum(fields.buyerSideCommissionAmount);

  // Contact: prefer buyer, fall back to seller, else address placeholder.
  const principalName = fields.buyerName?.trim() || fields.sellerName?.trim() || null;
  let contact;
  if (principalName) {
    contact = await db.contact.findFirst({
      where: { accountId, fullName: { equals: principalName, mode: "insensitive" } },
    });
    if (!contact) {
      contact = await db.contact.create({
        data: { accountId, fullName: principalName, sourceName },
      });
    }
  } else {
    contact = await db.contact.create({
      data: { accountId, fullName: `Transaction · ${fields.address}`, sourceName },
    });
  }

  const side: "buy" | "sell" =
    fields.buyerName && contact.fullName === fields.buyerName ? "buy" : "sell";

  // Dedup: same account + contact + address → return the existing deal.
  const existing = await db.transaction.findFirst({
    where: {
      accountId,
      contactId: contact.id,
      propertyAddress: { equals: fields.address, mode: "insensitive" },
    },
    select: { id: true, assetId: true },
  });
  if (existing) {
    return {
      created: false,
      transactionId: existing.id,
      assetId: existing.assetId,
      strategy: "retail",
      representation: "agency",
      milestonesCreated: 0,
      grossCommission: null,
    };
  }

  const stage =
    fields.contractStage &&
    ["offer", "counter", "executed", "unknown"].includes(fields.contractStage)
      ? fields.contractStage
      : "executed";

  const classification = classifyDeal({
    text: fields.contractText ?? null,
    hasRehabBudget: fields.rehabBudget,
    hasResaleIntent: fields.resaleIntent,
    hasRentEstimate: fields.rentEstimate,
    hasRefinanceIntent: fields.refinanceIntent,
    hasAssignmentClause: fields.assignmentClause,
    hasCashBuyerDisposition: fields.cashBuyerDisposition,
    twoClosingIntent: fields.twoClosingIntent,
    hasClientParty: !!(fields.buyerName || fields.sellerName),
    hasCommissionExpectation: !!(sellerPct || sellerAmt || buyerPct || buyerAmt),
  });

  const asset = await db.asset.create({
    data: {
      accountId,
      ownerUserId: actingUserId,
      address: fields.address.slice(0, 240),
      representation: classification.representation,
      strategy: classification.strategy,
      titlePath: classification.titlePath,
      creativeSubstructure: classification.creativeSubstructure,
    },
  });

  const txn = await db.transaction.create({
    data: {
      accountId,
      contactId: contact.id,
      assetId: asset.id,
      propertyAddress: fields.address.slice(0, 240),
      transactionType: side === "sell" ? "seller" : "buyer",
      side,
      status: "active",
      contractDate: effectiveDate,
      closingDate,
      possessionDate,
      inspectionDate: inspectionDeadline,
      inspectionObjectionDate: inspectionObjectionDeadline,
      titleDeadline: titleCommitmentDeadline,
      titleObjectionDate: titleObjectionDeadline,
      financingDeadline,
      walkthroughDate,
      earnestMoneyDueDate,
      earnestMoneyAmount,
      titleCompanyName: fields.titleCompany?.slice(0, 120) ?? null,
      lenderName: fields.lenderName?.slice(0, 120) ?? null,
      contractStage: stage,
      contractAppliedAt: new Date(),
      assignedUserId: actingUserId,
      rawSourceJson: {
        origin: "atlas_telegram_upload",
        earnestDueDerived,
      } as Prisma.InputJsonValue,
    },
  });

  const milestoneSpec: Array<{ type: string; label: string; dueAt: Date | null; ownerRole: string }> = [
    { type: "contract_effective", label: "Under contract", dueAt: effectiveDate, ownerRole: "agent" },
    {
      type: "earnest_money",
      label: earnestDueDerived ? "Earnest money due (3 biz days rule)" : "Earnest money due",
      dueAt: earnestMoneyDueDate,
      ownerRole: "client",
    },
    { type: "inspection", label: "Inspection deadline", dueAt: inspectionDeadline, ownerRole: "inspector" },
    { type: "inspection_objection", label: "Inspection objection deadline", dueAt: inspectionObjectionDeadline, ownerRole: "client" },
    { type: "title_commitment", label: "Title commitment due", dueAt: titleCommitmentDeadline, ownerRole: "title" },
    { type: "title_objection", label: "Title objection deadline", dueAt: titleObjectionDeadline, ownerRole: "client" },
    { type: "financing_approval", label: "Financing approval deadline", dueAt: financingDeadline, ownerRole: "lender" },
    {
      type: "walkthrough",
      label: walkthroughDerived ? "Final walkthrough (WY rule: close - 1d)" : "Final walkthrough",
      dueAt: walkthroughDate,
      ownerRole: "agent",
    },
    { type: "closing", label: "Closing", dueAt: closingDate, ownerRole: "title" },
    { type: "possession", label: "Possession", dueAt: possessionDate, ownerRole: "client" },
  ];
  let milestonesCreated = 0;
  for (const s of milestoneSpec) {
    if (!s.dueAt) continue;
    await db.milestone.create({
      data: {
        transactionId: txn.id,
        type: s.type,
        label: s.label,
        dueAt: s.dueAt,
        ownerRole: s.ownerRole,
        source: "extracted",
        confidenceScore: 0.9,
      },
    });
    milestonesCreated++;
  }

  // Financials — side-matching commission; direct $ wins, else pct × price.
  const myPct = side === "sell" ? sellerPct : buyerPct;
  const myAmt = side === "sell" ? sellerAmt : buyerAmt;
  let grossCommission: number | null = null;
  if (myAmt && myAmt > 0) grossCommission = myAmt;
  else if (myPct && purchasePrice) {
    const pct = myPct > 1 ? myPct / 100 : myPct;
    grossCommission = Math.round(purchasePrice * pct);
  }
  const myPctRaw = myPct != null ? (myPct > 1 ? myPct : myPct * 100) : null;
  if (purchasePrice !== null || grossCommission !== null || myPctRaw !== null) {
    await db.transactionFinancials.upsert({
      where: { transactionId: txn.id },
      create: {
        transactionId: txn.id,
        salePrice: purchasePrice ?? null,
        commissionPercent: myPctRaw,
        grossCommission,
      },
      update: {},
    });
  }

  // Seed stage-1 tasks for investor strategies (wholesale/flip/etc).
  if (hasStageLifecycle(classification.strategy)) {
    try {
      await applyStrategyTemplate(db, { assetId: asset.id, transactionId: txn.id });
    } catch {
      /* non-blocking */
    }
  }

  return {
    created: true,
    transactionId: txn.id,
    assetId: asset.id,
    strategy: classification.strategy,
    representation: classification.representation,
    milestonesCreated,
    grossCommission,
  };
}
