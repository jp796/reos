/**
 * Tests for HoldingCostMeter (spec §7).
 * Run with: bun tsx src/services/core/HoldingCostMeter.test.ts
 */

import { computeHoldingCost, carriesHoldingCost } from "./HoldingCostMeter";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function near(a: number, b: number, msg: string) {
  assert(Math.abs(a - b) < 1, `${msg} (got ${a}, want ~${b})`);
}
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("HoldingCostMeter — §7");

check("only takes_title carries holding cost", () => {
  assert(carriesHoldingCost("takes_title"), "takes_title carries");
  assert(!carriesHoldingCost("assignment"), "assignment does not");
  assert(!carriesHoldingCost("contract_rights"), "contract_rights does not");
  assert(!carriesHoldingCost(null), "null does not");
});

check("accrues ~one month of carry over ~30.44 days", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const asOf = new Date("2026-01-31T10:30:00Z"); // ~30.4 days
  const r = computeHoldingCost({
    startDate: start,
    asOf,
    monthlyInterest: 900,
    monthlyTaxes: 200,
    monthlyInsurance: 100,
    monthlyUtilities: 150,
  });
  assert(r.daysHeld === 30, `daysHeld=${r.daysHeld}`);
  // monthly total 1350 → daily ~44.35 → 30d ~1330
  near(r.accrued, 1330, "accrued ~1 month");
  near(r.breakdown.interest, 887, "interest breakdown");
});

check("zero days held → zero accrued", () => {
  const d = new Date("2026-06-14T00:00:00Z");
  const r = computeHoldingCost({ startDate: d, asOf: d, monthlyInterest: 900 });
  assert(r.daysHeld === 0, "0 days");
  assert(r.accrued === 0, "0 accrued");
});

check("daily rate is monthly/30.4375", () => {
  const start = new Date("2026-01-01");
  const r = computeHoldingCost({
    startDate: start,
    asOf: new Date("2026-02-01"),
    monthlyOther: 304.375,
  });
  near(r.dailyRate, 10, "daily rate");
});

console.log(`\n${passed} passed.`);
