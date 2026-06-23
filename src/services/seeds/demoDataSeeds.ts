/**
 * Demo data seeds — generate realistic-looking sample transactions
 * tagged isDemo=true. Filtered out of every analytics rollup.
 *
 * Wipe via /api/admin/demo-data DELETE — removes every isDemo=true
 * row scoped to the actor's account.
 */

import { type PrismaClient, Prisma } from "@prisma/client";
import { getStrategyTemplate, hasStageLifecycle } from "@/services/core/strategyTemplates";
import { applyStrategyTemplate } from "@/services/core/StageEngine";
import type { Strategy } from "@/services/core/DealClassifierService";

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

interface InvestorSpec {
  strategy: Strategy;
  titlePath: string;
  creativeSubstructure?: string;
  addr: string;
  city: string;
  state: string;
  zip: string;
  closed?: boolean;
  economics: Record<string, number>;
  capital?: { type: string; principal: number; rate: number; balloonMonths: number; notes: string };
  draws?: { milestone: string; amount: number; status: string }[];
  drawBudget?: number;
}

const INVESTOR_DEALS: InvestorSpec[] = [
  {
    strategy: "flip",
    titlePath: "takes_title",
    addr: "1408 Windmill Road",
    city: "Cheyenne",
    state: "WY",
    zip: "82001",
    economics: { purchasePrice: 285000, rehabBudget: 62000, holdingCosts: 7500, sellingCosts: 19000, salePrice: 419000 },
    capital: { type: "private_money", principal: 230000, rate: 11, balloonMonths: 6, notes: "Hard-money acquisition + rehab" },
    drawBudget: 62000,
    draws: [
      { milestone: "Demo + haul-off", amount: 15000, status: "paid" },
      { milestone: "Rough-in (plumbing / electrical)", amount: 20000, status: "released" },
    ],
  },
  {
    strategy: "wholesale",
    titlePath: "assignment",
    addr: "905 Logan Avenue",
    city: "Cheyenne",
    state: "WY",
    zip: "82001",
    economics: { assignmentFee: 18000 },
  },
  {
    strategy: "rental_brrrr",
    titlePath: "takes_title",
    addr: "2230 Carey Avenue",
    city: "Cheyenne",
    state: "WY",
    zip: "82001",
    economics: { monthlyRent: 2250, monthlyDebtService: 1180, allInCost: 215000 },
  },
  {
    strategy: "creative",
    titlePath: "contract_rights",
    creativeSubstructure: "subject_to",
    addr: "618 W 5th Street",
    city: "Casper",
    state: "WY",
    zip: "82601",
    economics: { purchasePrice: 300000, entryCost: 12000, expectedExitValue: 365000 },
  },
  {
    strategy: "flip",
    titlePath: "takes_title",
    addr: "744 House Avenue",
    city: "Cheyenne",
    state: "WY",
    zip: "82007",
    closed: true,
    economics: { purchasePrice: 240000, rehabBudget: 48000, holdingCosts: 6000, sellingCosts: 16000, salePrice: 365000 },
  },
];

/**
 * Investor demo deals — principal Assets across strategies (flip /
 * wholesale / rental / creative) with economics, stage tasks, and (for a
 * flip) a draw schedule + capital stack. Powers the Investment lens,
 * Board, deal-page investor surfaces, Economics, and (the closed flip)
 * the Production investment P&L. All isDemo=true → wiped with the rest.
 */
export async function seedInvestorDeals(
  db: PrismaClient,
  args: SeedDemoArgs,
): Promise<{ created: number; ids: string[] }> {
  const ids: string[] = [];
  for (const spec of INVESTOR_DEALS) {
    const contact = await db.contact.create({
      data: {
        accountId: args.accountId,
        fullName: `Owner · ${spec.addr}`,
        sourceName: "demo-data",
      },
      select: { id: true },
    });

    const stages = getStrategyTemplate(spec.strategy);
    const asset = await db.asset.create({
      data: {
        accountId: args.accountId,
        ownerUserId: args.ownerUserId,
        address: spec.addr,
        representation: "principal",
        strategy: spec.strategy,
        titlePath: spec.titlePath,
        creativeSubstructure: spec.creativeSubstructure ?? null,
        currentStageName: spec.closed
          ? (stages[stages.length - 1]?.key ?? null)
          : (stages[0]?.key ?? null),
        economicsJson: spec.economics as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    const contractDate = daysFromNow(-Math.floor(20 + Math.random() * 40));
    const closingDate = spec.closed
      ? daysFromNow(-Math.floor(3 + Math.random() * 14))
      : daysFromNow(Math.floor(20 + Math.random() * 40));

    const txn = await db.transaction.create({
      data: {
        accountId: args.accountId,
        contactId: contact.id,
        assignedUserId: args.ownerUserId,
        assetId: asset.id,
        status: spec.closed ? "closed" : "active",
        side: "buy",
        transactionType: "buyer",
        propertyAddress: spec.addr,
        city: spec.city,
        state: spec.state,
        zip: spec.zip,
        contractDate,
        closingDate,
        titleCompanyName: "Flying S Title and Escrow",
        isDemo: true,
      },
      select: { id: true },
    });
    ids.push(txn.id);

    // Stage-1 tasks (board columns / Stage panel).
    if (hasStageLifecycle(spec.strategy)) {
      try {
        await applyStrategyTemplate(db, { assetId: asset.id, transactionId: txn.id });
      } catch {
        /* non-blocking */
      }
    }

    // Draw schedule + capital stack (flip only).
    if (spec.drawBudget) {
      const sched = await db.drawSchedule.create({
        data: { assetId: asset.id, accountId: args.accountId, totalBudget: spec.drawBudget, status: "active" },
        select: { id: true },
      });
      for (const d of spec.draws ?? []) {
        await db.draw.create({
          data: { drawScheduleId: sched.id, assetId: asset.id, milestone: d.milestone, amount: d.amount, status: d.status },
        });
      }
    }
    if (spec.capital) {
      await db.capitalStackEntry.create({
        data: {
          assetId: asset.id,
          accountId: args.accountId,
          type: spec.capital.type,
          principal: spec.capital.principal,
          rate: spec.capital.rate,
          balloonDate: daysFromNow(spec.capital.balloonMonths * 30),
          notes: spec.capital.notes,
        },
      });
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
    select: { id: true, contactId: true, assetId: true },
  });
  const txnIds = txns.map((t) => t.id);
  // Cascade-delete via Transaction's relations (milestones, tasks,
  // documents, financials, participants, etc. all have onDelete: Cascade)
  await db.transaction.deleteMany({
    where: { accountId, isDemo: true },
  });
  // Demo investor Assets aren't cascaded by the transaction delete (the
  // FK points txn → asset). Remove the now-orphaned demo Assets, which
  // cascades their draw schedules, draws, and capital-stack entries.
  const assetIds = [...new Set(txns.map((t) => t.assetId).filter((a): a is string => !!a))];
  if (assetIds.length > 0) {
    await db.asset.deleteMany({ where: { id: { in: assetIds }, accountId } });
  }
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
