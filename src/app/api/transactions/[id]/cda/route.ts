/**
 * GET /api/transactions/:id/cda
 *
 * Generate + stream the Commission Disbursement Authorization PDF
 * for this transaction. One-click download — TC attaches it to the
 * email going to title/settlement.
 *
 * Reads brokerage metadata from Account.settingsJson.broker. Missing
 * fields render as blank lines so a printed copy can still be hand-
 * filled for urgent disbursements.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import {
  generateCda,
  type BrokerSettings,
} from "@/services/core/CdaGeneratorService";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: {
      contact: true,
      financials: true,
      participants: { include: { contact: true } },
      account: true,
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  // Extract broker settings from Account.settingsJson.broker. Falls
  // back to account.businessName as the brokerage if not configured.
  const settings = (txn.account.settingsJson ?? {}) as Record<string, unknown>;
  const brokerRaw = (settings.broker ?? {}) as Record<string, unknown>;
  const brokerage: BrokerSettings = {
    brokerageName:
      (brokerRaw.brokerageName as string) ??
      txn.account.businessName ??
      undefined,
    brokerageAddress: (brokerRaw.brokerageAddress as string) ?? undefined,
    brokerageLicense: (brokerRaw.brokerageLicense as string) ?? undefined,
    brokeragePhone: (brokerRaw.brokeragePhone as string) ?? undefined,
    brokerageEmail: (brokerRaw.brokerageEmail as string) ?? undefined,
    brokerageEin: (brokerRaw.brokerageEin as string) ?? undefined,
    designatedBrokerName:
      (brokerRaw.designatedBrokerName as string) ?? undefined,
    designatedBrokerLicense:
      (brokerRaw.designatedBrokerLicense as string) ?? undefined,
    agentName:
      (brokerRaw.agentName as string) ?? actor.name ?? undefined,
    agentLicense: (brokerRaw.agentLicense as string) ?? undefined,
  };

  // Party names — primary contact + same-role participants.
  const buyers: string[] = [];
  const sellers: string[] = [];
  const primarySide = txn.side;
  if (primarySide === "buy" || primarySide === "both") {
    buyers.push(txn.contact.fullName);
  }
  if (primarySide === "sell" || primarySide === "both") {
    sellers.push(txn.contact.fullName);
  }
  for (const p of txn.participants) {
    if (p.role === "co_buyer") buyers.push(p.contact.fullName);
    if (p.role === "co_seller") sellers.push(p.contact.fullName);
  }

  const pdf = await generateCda({
    brokerage,
    transaction: {
      propertyAddress: txn.propertyAddress,
      city: txn.city,
      state: txn.state,
      zip: txn.zip,
      closingDate: txn.closingDate,
      side: txn.side,
      buyers: [...new Set(buyers)],
      sellers: [...new Set(sellers)],
      titleCompanyName: txn.titleCompanyName,
    },
    financials: {
      salePrice: txn.financials?.salePrice ?? null,
      grossCommission: txn.financials?.grossCommission ?? null,
      referralFeeAmount: txn.financials?.referralFeeAmount ?? null,
      brokerageSplitAmount: txn.financials?.brokerageSplitAmount ?? null,
      netCommission: txn.financials?.netCommission ?? null,
      commissionPercent: txn.financials?.commissionPercent ?? null,
    },
  });

  const addrSlug = (txn.propertyAddress ?? "transaction")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  const filename = `CDA-${addrSlug}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
