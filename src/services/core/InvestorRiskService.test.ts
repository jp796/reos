/**
 * Tests for InvestorRiskService (spec §10).
 * Run with: bun tsx src/services/core/InvestorRiskService.test.ts
 */

import { computeInvestorRisk } from "./InvestorRiskService";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
const has = (factors: { type: string }[], t: string) => factors.some((x) => x.type === t);
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("InvestorRiskService — §10");

check("clean deal scores 0", () => {
  const r = computeInvestorRisk({ strategy: "flip" });
  assert(r.score === 0, `score=${r.score}`);
  assert(r.factors.length === 0, "no factors");
});

check("flip over budget + long hold flags both", () => {
  const r = computeInvestorRisk({
    strategy: "flip",
    titlePath: "takes_title",
    rehabBudget: 40000,
    rehabSpent: 50000, // 25% over
    daysHeld: 220,
  });
  assert(has(r.factors, "rehab_over_budget"), "over budget");
  assert(has(r.factors, "holding_costs"), "holding");
  assert(r.score > 0, "score > 0");
});

check("flip no buyer near completion is high severity", () => {
  const r = computeInvestorRisk({
    strategy: "flip",
    hasBuyer: false,
    daysToClosing: 20,
  });
  assert(has(r.factors, "no_buyer_near_completion"), "no buyer");
});

check("wholesale assignment window closing with no buyer", () => {
  const r = computeInvestorRisk({
    strategy: "wholesale",
    assignmentWindowDays: 5,
    hasBuyer: false,
  });
  assert(has(r.factors, "assignment_window_closing"), "window closing");
});

check("wholesale committed to seller but EMD not collected", () => {
  const r = computeInvestorRisk({
    strategy: "wholesale",
    committedToSeller: true,
    buyerEmdCollected: false,
  });
  assert(has(r.factors, "buyer_emd_not_collected"), "emd");
});

check("rental low DSCR + negative cash flow", () => {
  const r = computeInvestorRisk({
    strategy: "rental_brrrr",
    dscr: 0.9,
    monthlyCashFlow: -150,
  });
  assert(has(r.factors, "dscr_below_threshold"), "dscr");
  assert(has(r.factors, "negative_cash_flow"), "cashflow");
});

check("creative underlying-late is top severity (impact 40)", () => {
  const r = computeInvestorRisk({
    strategy: "creative",
    underlyingPaymentLate: true,
  });
  const factor = r.factors.find((x) => x.type === "underlying_payment_late");
  assert(factor?.impact === 40, `impact=${factor?.impact}`);
  assert(factor?.severity === "high", "high severity");
});

check("creative balloon unfunded flagged", () => {
  const r = computeInvestorRisk({
    strategy: "creative",
    balloonHorizonDays: 60,
    exitFunded: false,
  });
  assert(has(r.factors, "balloon_unfunded"), "balloon");
});

check("score caps at 100", () => {
  const r = computeInvestorRisk({
    strategy: "creative",
    underlyingPaymentLate: true,
    balloonHorizonDays: 10,
    exitFunded: false,
    insuranceLapsed: true,
    titlePath: "takes_title",
    daysHeld: 400,
  });
  assert(r.score <= 100, `score=${r.score}`);
});

console.log(`\n${passed} passed.`);
