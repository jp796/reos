/**
 * POST /api/transactions/:id/contract/apply
 *
 * Body: { extraction: ContractExtraction-shaped object, with any
 *         user-edited values }
 *
 * Writes confirmed fields from the pending extraction onto the
 * Transaction (dates, address, title co, lender), upserts any
 * compensation into TransactionFinancials, and creates/updates
 * Milestones for each deadline. All values remain editable via
 * existing forms on the txn detail page.
 *
 * After a successful apply, clears pendingContractJson and stamps
 * contractAppliedAt.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { addBusinessDays } from "@/lib/business-days";

type Field<T = unknown> = {
  value: T | null;
  confidence?: number;
  snippet?: string | null;
};

interface ApplyBody {
  extraction?: Record<string, unknown>;
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[,$\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function toStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
function fieldVal<T = unknown>(o: unknown, key: string): T | null {
  if (!o || typeof o !== "object") return null;
  const f = (o as Record<string, unknown>)[key] as Field<T> | undefined;
  if (!f || typeof f !== "object") return null;
  return (f.value ?? null) as T | null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: { financials: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const ext = body.extraction ?? txn.pendingContractJson;
  if (!ext || typeof ext !== "object") {
    return NextResponse.json(
      { error: "no extraction to apply" },
      { status: 400 },
    );
  }

  // --- Transaction field updates (skip nulls; never clobber existing values
  // except when the extraction gives us a better one)
  const data: Prisma.TransactionUpdateInput = {};
  const closingDate = toDate(fieldVal(ext, "closingDate"));
  if (closingDate) data.closingDate = closingDate;
  const possessionDate = toDate(fieldVal(ext, "possessionDate"));
  if (possessionDate) data.possessionDate = possessionDate;
  const inspectionDeadline = toDate(fieldVal(ext, "inspectionDeadline"));
  if (inspectionDeadline) data.inspectionDate = inspectionDeadline;
  const financingDeadline = toDate(fieldVal(ext, "financingDeadline"));
  if (financingDeadline) data.financingDeadline = financingDeadline;
  const titleDeadline = toDate(fieldVal(ext, "titleCommitmentDeadline"));
  if (titleDeadline) data.titleDeadline = titleDeadline;
  const effectiveDate = toDate(fieldVal(ext, "effectiveDate"));
  if (effectiveDate) data.contractDate = effectiveDate;
  // Earnest money due: prefer the explicit date on the contract; if
  // absent, most state forms default to "3 business days after mutual
  // acceptance" — compute from effectiveDate + 3 biz days.
  let earnestDue = toDate(fieldVal(ext, "earnestMoneyDueDate"));
  let earnestDueDerived = false;
  if (!earnestDue && effectiveDate) {
    earnestDue = addBusinessDays(effectiveDate, 3);
    earnestDueDerived = true;
  }
  if (earnestDue) data.earnestMoneyDueDate = earnestDue;
  const walkthrough = toDate(fieldVal(ext, "walkthroughDate"));
  if (walkthrough) data.walkthroughDate = walkthrough;
  const propertyAddress = toStr(fieldVal(ext, "propertyAddress"));
  if (propertyAddress && !txn.propertyAddress) data.propertyAddress = propertyAddress;
  const titleCo = toStr(fieldVal(ext, "titleCompanyName"));
  if (titleCo) data.titleCompanyName = titleCo;
  const lender = toStr(fieldVal(ext, "lenderName"));
  if (lender) data.lenderName = lender;

  // Contract lifecycle stage + signature dates
  const stage = toStr(fieldVal(ext, "contractStage"));
  if (stage && ["offer", "counter", "executed", "unknown"].includes(stage)) {
    data.contractStage = stage;
  }
  const buyerSignedAt = toDate(fieldVal(ext, "buyerSignedAt"));
  if (buyerSignedAt) data.buyerSignedAt = buyerSignedAt;
  const sellerSignedAt = toDate(fieldVal(ext, "sellerSignedAt"));
  if (sellerSignedAt) data.sellerSignedAt = sellerSignedAt;

  data.contractAppliedAt = new Date();
  data.pendingContractJson = Prisma.DbNull;

  await prisma.transaction.update({ where: { id: txn.id }, data });

  // --- Milestones: upsert one per extracted deadline.
  // Keyed by (transactionId, type) + source="contract_extraction" so a
  // re-apply updates instead of duplicates.
  const mileStoneSpec: Array<{ type: string; label: string; dueAt: Date | null; ownerRole: string }> = [
    { type: "contract_effective", label: "Under contract", dueAt: effectiveDate, ownerRole: "agent" },
    {
      type: "earnest_money",
      label: earnestDueDerived
        ? "Earnest money due (3 biz days rule)"
        : "Earnest money due",
      dueAt: earnestDue,
      ownerRole: "client",
    },
    { type: "inspection", label: "Inspection objection deadline", dueAt: inspectionDeadline, ownerRole: "inspector" },
    { type: "title_commitment", label: "Title commitment due", dueAt: titleDeadline, ownerRole: "title" },
    { type: "title_objection", label: "Title objection deadline", dueAt: toDate(fieldVal(ext, "titleObjectionDeadline")), ownerRole: "client" },
    { type: "financing_approval", label: "Financing approval deadline", dueAt: financingDeadline, ownerRole: "lender" },
    { type: "walkthrough", label: "Final walkthrough", dueAt: walkthrough, ownerRole: "agent" },
    { type: "closing", label: "Closing", dueAt: closingDate, ownerRole: "title" },
    { type: "possession", label: "Possession", dueAt: possessionDate, ownerRole: "client" },
  ];

  let milestonesUpserted = 0;
  for (const spec of mileStoneSpec) {
    if (!spec.dueAt) continue;
    const existing = await prisma.milestone.findFirst({
      where: { transactionId: txn.id, type: spec.type },
    });
    if (existing) {
      await prisma.milestone.update({
        where: { id: existing.id },
        data: {
          dueAt: spec.dueAt,
          label: spec.label,
          source: "extracted",
          confidenceScore: 0.9,
        },
      });
    } else {
      await prisma.milestone.create({
        data: {
          transactionId: txn.id,
          type: spec.type,
          label: spec.label,
          dueAt: spec.dueAt,
          ownerRole: spec.ownerRole,
          source: "extracted",
          confidenceScore: 0.9,
        },
      });
    }
    milestonesUpserted++;
  }

  // --- Compensation → TransactionFinancials (editable later by user)
  const purchasePrice = toNum(fieldVal<number>(ext, "purchasePrice"));
  const sellerPct = toNum(fieldVal<number>(ext, "sellerSideCommissionPct"));
  const sellerAmt = toNum(fieldVal<number>(ext, "sellerSideCommissionAmount"));
  const buyerPct = toNum(fieldVal<number>(ext, "buyerSideCommissionPct"));
  const buyerAmt = toNum(fieldVal<number>(ext, "buyerSideCommissionAmount"));

  const side = (txn.side ?? txn.transactionType ?? "").toLowerCase();
  // Figure out which commission line matches this transaction's side.
  const myPct = side === "sell" || side === "seller" || side === "listing"
    ? sellerPct
    : buyerPct;
  const myAmt = side === "sell" || side === "seller" || side === "listing"
    ? sellerAmt
    : buyerAmt;

  let computedGross: number | null = null;
  if (myAmt !== null && myAmt > 0) {
    computedGross = myAmt;
  } else if (myPct !== null && myPct > 0 && purchasePrice !== null && purchasePrice > 0) {
    // sellerSideCommissionPct is stored as decimal (0.03), not 3
    const pct = myPct > 1 ? myPct / 100 : myPct;
    computedGross = Math.round(purchasePrice * pct);
  }

  if (purchasePrice !== null || computedGross !== null) {
    await prisma.transactionFinancials.upsert({
      where: { transactionId: txn.id },
      create: {
        transactionId: txn.id,
        salePrice: purchasePrice ?? null,
        grossCommission: computedGross,
      },
      update: {
        ...(purchasePrice !== null
          ? { salePrice: purchasePrice }
          : {}),
        ...(computedGross !== null && !txn.financials?.grossCommission
          ? { grossCommission: computedGross }
          : {}),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    milestonesUpserted,
    appliedFields: Object.keys(data).filter(
      (k) => !["contractAppliedAt", "pendingContractJson"].includes(k),
    ),
    financials: {
      salePrice: purchasePrice,
      grossCommission: computedGross,
    },
  });
}
