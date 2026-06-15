/**
 * Tests for DealEconomicsService (spec §9).
 * Run with: bun tsx src/services/core/DealEconomicsService.test.ts
 */

import { computeEconomics, reconcile } from "./DealEconomicsService";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function near(a: number | null, b: number, msg: string) {
  assert(a != null && Math.abs(a - b) < 0.01, `${msg} (got ${a}, want ${b})`);
}
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("DealEconomicsService — §9");

check("flip profit + ROI + days-to-flip", () => {
  const e = computeEconomics("flip", {
    purchasePrice: 100000,
    rehabBudget: 40000,
    holdingCosts: 8000,
    buyingCosts: 2000,
    salePrice: 210000,
    sellingCosts: 15000,
    purchaseDate: new Date("2026-01-01"),
    saleDate: new Date("2026-05-01"),
  }) as Extract<ReturnType<typeof computeEconomics>, { kind: "flip" }>;
  near(e.allInCost, 150000, "allIn");
  near(e.profit, 45000, "profit"); // 210k - 15k - 150k
  near(e.roi!, 0.3, "roi"); // 45k / 150k
  assert(e.daysToFlip === 120, `daysToFlip=${e.daysToFlip}`);
});

check("wholesale spread + EMD exposure + days-to-assign", () => {
  const e = computeEconomics("wholesale", {
    assignmentFee: 12000,
    emd: 2500,
    contractDate: new Date("2026-03-01"),
    assignedDate: new Date("2026-03-15"),
  }) as Extract<ReturnType<typeof computeEconomics>, { kind: "wholesale" }>;
  near(e.spread, 12000, "spread");
  near(e.emdExposure, 2500, "emd");
  assert(e.daysToAssign === 14, `daysToAssign=${e.daysToAssign}`);
});

check("rental cash flow, cap rate, DSCR, capital-left-in", () => {
  const e = computeEconomics("rental_brrrr", {
    monthlyRent: 2000,
    monthlyDebtService: 900,
    monthlyTaxes: 200,
    monthlyInsurance: 100,
    monthlyMgmt: 160,
    monthlyMaintenance: 100,
    allInCost: 180000,
    totalInvested: 50000,
    cashOutRefi: 42000,
  }) as Extract<ReturnType<typeof computeEconomics>, { kind: "rental_brrrr" }>;
  // opex = 560; cashflow = 2000 - 560 - 900 = 540
  near(e.monthlyCashFlow, 540, "cashflow");
  // NOI annual = (2000-560)*12 = 17280
  near(e.noiAnnual, 17280, "noi");
  near(e.capRate!, 0.096, "capRate"); // 17280/180000
  near(e.dscr!, 1.6, "dscr"); // 17280 / (900*12=10800)
  near(e.capitalLeftIn, 8000, "capitalLeftIn"); // 50000-42000
});

check("creative cash flow, entry/exit spread, balloon horizon", () => {
  const e = computeEconomics("creative", {
    incomingMonthlyPayment: 1800,
    underlyingMonthlyPayment: 1100,
    monthlyExpenses: 150,
    purchasePrice: 200000,
    entryCost: 10000,
    expectedExitValue: 250000,
    balloonDate: new Date("2027-06-14"),
    now: new Date("2026-06-14"),
  }) as Extract<ReturnType<typeof computeEconomics>, { kind: "creative" }>;
  near(e.monthlyCashFlow, 550, "cashflow"); // 1800-1100-150
  near(e.entrySpread, 40000, "entrySpread"); // 250k-200k-10k
  near(e.exitSpread, 50000, "exitSpread"); // 250k-200k
  assert(e.balloonHorizonDays === 365, `balloon=${e.balloonHorizonDays}`);
});

check("retail GCI from % when gross not given; net deducts fees", () => {
  const e = computeEconomics("retail", {
    salePrice: 300000,
    commissionPercent: 3,
    referralFee: 1000,
    brokerageSplit: 2000,
  }) as Extract<ReturnType<typeof computeEconomics>, { kind: "retail" }>;
  near(e.grossCommission, 9000, "gci"); // 3% of 300k
  near(e.netCommission, 6000, "net"); // 9000-1000-2000
});

check("partial inputs degrade gracefully (no throw, nulls)", () => {
  const e = computeEconomics("flip", { purchasePrice: 100000 }) as Extract<
    ReturnType<typeof computeEconomics>,
    { kind: "flip" }
  >;
  near(e.allInCost, 100000, "allIn from purchase only");
  assert(e.profit === null, "profit null without sale");
  assert(e.roi === null, "roi null without profit");
});

check("reconcile computes variance + pct", () => {
  const r = reconcile(40000, 45000);
  near(r.variance, 5000, "variance");
  near(r.variancePct!, 0.125, "variancePct");
  const empty = reconcile(null, 5);
  assert(empty.variance === null, "null projected → null variance");
});

console.log(`\n${passed} passed.`);
