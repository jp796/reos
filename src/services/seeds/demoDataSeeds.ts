/**
 * Demo data seeds — generate realistic-looking sample transactions
 * tagged isDemo=true. Filtered out of every analytics rollup.
 *
 * Wipe via /api/admin/demo-data DELETE — removes every isDemo=true
 * row scoped to the actor's account.
 */

import type { PrismaClient } from "@prisma/client";

const FAKE_BUYERS: Array<{ name: string; email: string; phone: string }> = [
  { name: "Marcus Hale", email: "marcus.hale@example.com", phone: "3075550101" },
  { name: "Priya Patel", email: "priya.patel@example.com", phone: "3075550102" },
  { name: "Tom & Sarah Brennan", email: "brennanfam@example.com", phone: "3075550103" },
  { name: "Riley Chen", email: "riley.chen@example.com", phone: "3075550104" },
  { name: "Diego Romero", email: "diego.romero@example.com", phone: "3075550105" },
];
const FAKE_SELLERS: Array<{ name: string; email: string; phone: string }> = [
  { name: "Linda Foster", email: "linda.foster@example.com", phone: "3075550201" },
  { name: "James & Karen Wu", email: "wufamily@example.com", phone: "3075550202" },
  { name: "Robert Anderson", email: "robert.anderson@example.com", phone: "3075550203" },
];
const FAKE_PROPS = [
  { addr: "412 Cedar Ridge Drive", city: "Cheyenne", state: "WY", zip: "82001", price: 425000 },
  { addr: "8821 Aspen Lane", city: "Cheyenne", state: "WY", zip: "82009", price: 590000 },
  { addr: "227 Pine Street", city: "Laramie", state: "WY", zip: "82070", price: 310000 },
  { addr: "1554 Mountain View Way", city: "Casper", state: "WY", zip: "82601", price: 485000 },
  { addr: "63 Elk Crossing", city: "Bar Nunn", state: "WY", zip: "82601", price: 665000 },
  { addr: "9012 Harvest Meadow", city: "Cheyenne", state: "WY", zip: "82009", price: 525000 },
  { addr: "318 Sunrise Court", city: "Cheyenne", state: "WY", zip: "82001", price: 395000 },
  { addr: "775 Bluebird Lane", city: "Casper", state: "WY", zip: "82604", price: 445000 },
];

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

export interface SeedDemoArgs {
  accountId: string;
  ownerUserId: string;
  count?: number;
}

export async function seedDemoTransactions(
  db: PrismaClient,
  args: SeedDemoArgs,
): Promise<{ created: number; ids: string[] }> {
  const count = Math.min(Math.max(args.count ?? 6, 1), 12);
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const prop = FAKE_PROPS[i % FAKE_PROPS.length]!;
    const isListing = i % 4 === 0;
    const isClosed = i % 5 === 0 && !isListing;
    const isBuy = !isListing && i % 2 === 0;

    const primary = isListing
      ? FAKE_SELLERS[i % FAKE_SELLERS.length]!
      : isBuy
        ? FAKE_BUYERS[i % FAKE_BUYERS.length]!
        : FAKE_SELLERS[i % FAKE_SELLERS.length]!;

    const contact = await db.contact.create({
      data: {
        accountId: args.accountId,
        fullName: primary.name,
        primaryEmail: primary.email,
        primaryPhone: primary.phone,
        sourceName: "demo-data",
      },
      select: { id: true },
    });

    const status = isListing ? "listing" : isClosed ? "closed" : "active";
    const side = isListing ? "sell" : isBuy ? "buy" : "sell";

    // Date math: contracts in past, closings in future (or recent past for closed)
    const contractDate = isListing
      ? null
      : isClosed
        ? daysFromNow(-Math.floor(30 + Math.random() * 60))
        : daysFromNow(-Math.floor(7 + Math.random() * 21));
    const closingDate = isListing
      ? null
      : isClosed
        ? daysFromNow(-Math.floor(2 + Math.random() * 10))
        : daysFromNow(Math.floor(15 + Math.random() * 45));

    const txn = await db.transaction.create({
      data: {
        accountId: args.accountId,
        contactId: contact.id,
        assignedUserId: args.ownerUserId,
        status,
        side,
        transactionType: side === "sell" ? "seller" : "buyer",
        propertyAddress: prop.addr,
        city: prop.city,
        state: prop.state,
        zip: prop.zip,
        listPrice: isListing ? prop.price : null,
        contractDate,
        closingDate,
        listDate: isListing ? daysFromNow(-Math.floor(Math.random() * 14)) : null,
        listingExpirationDate: isListing ? daysFromNow(90) : null,
        lenderName: isBuy ? "Mountain West Mortgage" : null,
        titleCompanyName: "Flying S Title and Escrow",
        isDemo: true,
      },
      select: { id: true },
    });
    ids.push(txn.id);

    // Financials for closed deals
    if (isClosed) {
      await db.transactionFinancials.create({
        data: {
          transactionId: txn.id,
          salePrice: prop.price,
          commissionPercent: 3,
          grossCommission: Math.round(prop.price * 0.03),
        },
      });
    } else if (!isListing) {
      await db.transactionFinancials.create({
        data: {
          transactionId: txn.id,
          salePrice: prop.price,
          commissionPercent: 3,
          grossCommission: Math.round(prop.price * 0.03),
        },
      });
    }

    // A few milestones for active deals
    if (status === "active" && contractDate) {
      const ms: Array<{ type: string; label: string; due: Date | null; ownerRole: string }> = [
        { type: "contract_effective", label: "Under contract", due: contractDate, ownerRole: "agent" },
        { type: "earnest_money", label: "Earnest money due (3 biz days rule)", due: daysFromNow(2), ownerRole: "client" },
        { type: "inspection", label: "Inspection deadline", due: daysFromNow(5), ownerRole: "inspector" },
        { type: "title_commitment", label: "Title commitment due", due: daysFromNow(10), ownerRole: "title" },
        { type: "financing_approval", label: "Financing approval deadline", due: daysFromNow(20), ownerRole: "lender" },
        { type: "closing", label: "Closing", due: closingDate, ownerRole: "title" },
      ];
      for (const m of ms) {
        if (!m.due) continue;
        await db.milestone.create({
          data: {
            transactionId: txn.id,
            type: m.type,
            label: m.label,
            dueAt: m.due,
            ownerRole: m.ownerRole,
            source: "demo_seed",
            status: "pending",
          },
        });
      }
    }
  }

  return { created: ids.length, ids };
}

export async function wipeDemoTransactions(
  db: PrismaClient,
  accountId: string,
): Promise<{ deletedTransactions: number; deletedContacts: number }> {
  const txns = await db.transaction.findMany({
    where: { accountId, isDemo: true },
    select: { id: true, contactId: true },
  });
  const txnIds = txns.map((t) => t.id);
  // Cascade-delete via Transaction's relations (milestones, tasks,
  // documents, financials, participants, etc. all have onDelete: Cascade)
  await db.transaction.deleteMany({
    where: { accountId, isDemo: true },
  });
  // Also clean up demo-tagged contacts that aren't referenced anywhere else
  const contactIds = [...new Set(txns.map((t) => t.contactId))];
  let deletedContacts = 0;
  for (const cid of contactIds) {
    const stillUsed = await db.transaction.count({
      where: { contactId: cid },
    });
    if (stillUsed === 0) {
      const c = await db.contact.findUnique({
        where: { id: cid },
        select: { sourceName: true },
      });
      if (c?.sourceName === "demo-data") {
        await db.contact.delete({ where: { id: cid } });
        deletedContacts++;
      }
    }
  }
  return { deletedTransactions: txnIds.length, deletedContacts };
}
