/**
 * POST /api/automation/create-from-scan
 *
 * Called from the "Scan for accepted contracts" panel when the user
 * clicks "Create transaction" on a hit. Creates a contact (if not
 * found), then a transaction with contractStage="executed" so the
 * calendar-sync button is immediately unlocked.
 *
 * Body: { address, buyerName?, sellerName?, closingDate?,
 *         effectiveDate?, purchasePrice?, titleCompany?, threadId? }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

function toDate(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "no account" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as {
    address?: string;
    buyerName?: string | null;
    sellerName?: string | null;
    closingDate?: string;
    effectiveDate?: string;
    purchasePrice?: number | null;
    titleCompany?: string | null;
    threadId?: string | null;
  } | null;
  if (!body?.address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const closingDate = toDate(body.closingDate);
  const effectiveDate = toDate(body.effectiveDate);

  // Match or create a contact. Prefer buyer, fall back to seller.
  // If neither, create a placeholder "Transaction for <address>" contact.
  const principalName =
    body.buyerName?.trim() || body.sellerName?.trim() || null;
  let contact;
  if (principalName) {
    contact = await prisma.contact.findFirst({
      where: {
        accountId: account.id,
        fullName: { equals: principalName, mode: "insensitive" },
      },
    });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          accountId: account.id,
          fullName: principalName,
          sourceName: "Gmail scan · accepted contract",
        },
      });
    }
  } else {
    contact = await prisma.contact.create({
      data: {
        accountId: account.id,
        fullName: `Transaction · ${body.address}`,
        sourceName: "Gmail scan · accepted contract",
      },
    });
  }

  // Side inference: if buyerName matches the logged-in user's contact,
  // this is a buy-side deal; if sellerName matches, sell-side. Without
  // that info just default to buyer.
  const side: "buy" | "sell" =
    body.buyerName && contact.fullName === body.buyerName ? "buy" : "sell";

  const existing = await prisma.transaction.findFirst({
    where: {
      accountId: account.id,
      contactId: contact.id,
      propertyAddress: { equals: body.address, mode: "insensitive" },
    },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      created: false,
      transactionId: existing.id,
    });
  }

  const txn = await prisma.transaction.create({
    data: {
      accountId: account.id,
      contactId: contact.id,
      propertyAddress: body.address.slice(0, 240),
      transactionType: side === "sell" ? "seller" : "buyer",
      side,
      status: "active",
      contractDate: effectiveDate,
      closingDate,
      titleCompanyName: body.titleCompany?.slice(0, 120) ?? null,
      contractStage: "executed",
      rawSourceJson: {
        origin: "scan_accepted_contracts",
        threadId: body.threadId ?? null,
        purchasePrice: body.purchasePrice ?? null,
      },
    },
  });

  // Seed milestones based on the dates we already know. Minimum-viable —
  // user can apply the full contract later via upload for the full set.
  const seeds: Array<{ type: string; label: string; dueAt: Date | null; ownerRole: string }> = [
    { type: "contract_effective", label: "Under contract", dueAt: effectiveDate, ownerRole: "agent" },
    { type: "closing", label: "Estimated closing", dueAt: closingDate, ownerRole: "title" },
  ];
  for (const s of seeds) {
    if (!s.dueAt) continue;
    await prisma.milestone.create({
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
  }

  // Upsert financials if price provided
  if (body.purchasePrice) {
    await prisma.transactionFinancials.upsert({
      where: { transactionId: txn.id },
      create: {
        transactionId: txn.id,
        salePrice: body.purchasePrice,
      },
      update: { salePrice: body.purchasePrice },
    });
  }

  return NextResponse.json({
    ok: true,
    created: true,
    transactionId: txn.id,
    contactId: contact.id,
  });
}
