import { test, expect, describe } from "bun:test";
import { computeFlip, DEFAULT_FLIP_INPUTS, type FlipInputs } from "./FlipCalcModel";
import { PMT } from "@/lib/finance";

const near = (a: number, b: number, tol = 0.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

const base: FlipInputs = {
  ...DEFAULT_FLIP_INPUTS,
  sqft: 1500,
  offerPrice: 100000,
  flipRehabBudget: 30000,
  flipComps: [
    { salePrice: 225000, sqft: 1500 }, // 150/sf
    { salePrice: 300000, sqft: 2000 }, // 150/sf
  ],
};

describe("comps → ARV", () => {
  test("averages $/sqft and drives Fix&Flip ARV", () => {
    const r = computeFlip(base);
    near(r.comps.avgPricePerSqft, 150);
    near(r.fixFlip.arv, 225000); // 1500 sqft × $150
  });

  test("ignores empty/zero comp rows", () => {
    const r = computeFlip({ ...base, flipComps: [{ salePrice: 0, sqft: 1500 }, { salePrice: 300000, sqft: 2000 }] });
    near(r.comps.avgPricePerSqft, 150); // only the valid row counts
  });
});

describe("Fix & Flip scenario (hand-checked against the sheet)", () => {
  const r = computeFlip(base);
  test("rehab estimator", () => {
    near(r.rehab.light, 30000); // 1500×20
    near(r.rehab.medium, 52500); // 1500×35
    near(r.rehab.big, 75000); // 1500×50
    near(r.rehab.chosen, 52500); // default Medium
  });
  test("closing costs auto = offer × title fee", () => {
    near(r.closingCostsAuto, 1500); // 100000 × 0.015
  });
  test("interest, expenses, profit", () => {
    near(r.fixFlip.interest, 7800); // (100000+30000)×(0.12/12×6)
    near(r.fixFlip.totalExpenses, 154150);
    near(r.fixFlip.profit, 70850);
  });
  test("max-offer targets + break-even", () => {
    near(r.fixFlip.maxOfferForProfit, 120850); // ARV − (exp−offer) − 50k
    near(r.fixFlip.maxOffer70Ltv, 127500); // ARV×0.7 − rehab
    near(r.fixFlip.breakEvenOffer, 170850);
  });
  test("splits + extra realtor", () => {
    near(r.fixFlip.fluellen, 70850); // 100% by default
    near(r.fixFlip.partner, 0);
    near(r.fixFlip.extraRealtor, 0); // commissionType None
  });
  test("seller-agent commission adds ARV × listing %", () => {
    const r2 = computeFlip({ ...base, commissionType: "Seller Agent" });
    near(r2.fixFlip.extraRealtor, 225000 * 0.025); // 5625
    const r3 = computeFlip({ ...base, commissionType: "Referral Agent" });
    near(r3.fixFlip.extraRealtor, (225000 * 0.025) / 3);
  });
});

describe("DSCR rental wiring", () => {
  const r = computeFlip({
    ...base,
    rentalARV: 200000,
    rentMonthly: 1800,
    rentalInsuranceMonthly: 100,
    rentalPropertyTaxAnnual: 2400,
  });
  test("loan = 70% ARV and P&I matches PMT", () => {
    near(r.rental.loanAmount, 140000);
    const expectedPI = PMT(0.085 / 12, 360, 140000, 0, 1) * -1;
    near(r.rental.monthlyPI, expectedPI);
  });
  test("monthly cashflow = rent − all monthly expenses", () => {
    const exp = 100 + 2400 / 12 + 1800 * 0.08 + 1800 * (1 / 12) + 1800 * 0.1 + r.rental.monthlyPI;
    near(r.rental.monthlyExpenses, exp);
    near(r.rental.monthlyCashflow, 1800 - exp);
  });
});

describe("owner finance wiring", () => {
  const r = computeFlip({ ...base, ofMarketValue: 200000, ofSalePrice: 220000 });
  test("down payment + my loan", () => {
    near(r.ownerFinance.downPayment, 40000); // 20%
    near(r.ownerFinance.myLoanAmount, 140000); // 70%
  });
  test("total 3yr profit = initial + cashflow + payoff profit", () => {
    const of = r.ownerFinance;
    near(of.totalProfit3yr, of.initialCashProfit + of.cashflowTotal3yr + of.finalPayoffProfit);
  });
});

describe("defaults are safe", () => {
  test("empty inputs produce zeros, not NaN", () => {
    const r = computeFlip(DEFAULT_FLIP_INPUTS);
    for (const v of [
      r.fixFlip.profit,
      r.fixFlip.arv,
      r.wholetail.profit,
      r.rental.totalProfit3yr,
      r.rental.cocReturnAnnualized,
      r.ownerFinance.totalProfit3yr,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
