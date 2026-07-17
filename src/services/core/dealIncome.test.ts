import { test, expect, describe } from "bun:test";
import { computeDualIncome, coerceFlipInputs } from "./dealIncome";
import { DEFAULT_FLIP_INPUTS, type FlipInputs } from "./FlipCalcModel";

/**
 * Numbers asserted here are read straight from JP's workbook, "2315 Thomes"
 * sheet (Fix & Flip column):
 *   Offer B9=195000 · Rehab B17=10000 · ARV B20=270000 · Holding B21=4mo
 *   Title B11=0.015 → Closing H12=2925 · Carry E9:E12 = 2400·3 = 7200/yr
 *   Comm listing H9=0.025, buyer H10=0.025 · seller-agent
 *   Interest B24=6900 & Points B25=3000 (hand-typed on the sheet → overrides)
 *   ⇒ Total Expenses B26=233725 · PROFIT B30=36275 · Extra Realtor B35=6750
 */
const thomes2315: FlipInputs = {
  ...DEFAULT_FLIP_INPUTS,
  sqft: 0,
  offerPrice: 195000,
  titleFeePct: 0.015,
  propertyTaxAnnual: 2400,
  insuranceAnnual: 2400,
  utilitiesAnnual: 2400,
  otherAnnual: 0,
  commListingPct: 0.025,
  commBuyerPct: 0.025,
  commissionType: "Seller Agent",
  flipRehabBudget: 10000,
  flipHoldingMonths: 4,
  arvOverride: 270000,
  flipInterestOverride: 6900,
  flipPointsOverride: 3000,
};

describe("dual-income ledger matches JP's workbook (2315 Thomes)", () => {
  test("flip → investment return B30 = 36275, realtor commission B35 = 6750", () => {
    const r = computeDualIncome("flip", thomes2315);
    expect(r.investmentReturn).toBe(36275);
    expect(r.realtorCommission).toBe(6750);
    expect(r.basis).toBe("flip_calc:fix_flip");
  });
});

describe("strategy → workbook scenario mapping", () => {
  const inputs = coerceFlipInputs({
    ...thomes2315,
    wholetailARV: 250000,
    wholetailRehabBudget: 0,
    wholetailHoldingMonths: 3,
    rentalARV: 200000,
    rentMonthly: 1800,
    rentalLoanRate: 0.085,
    rentalAmortYears: 30,
  });

  test("wholetail maps to the Wholetail column (profit E30 / commission E35)", () => {
    const r = computeDualIncome("wholetail", inputs);
    expect(r.basis).toBe("flip_calc:wholetail");
    // seller agent → commission = wholetail ARV × listing%
    expect(r.realtorCommission).toBe(Math.round(250000 * 0.025));
    expect(typeof r.investmentReturn).toBe("number");
  });

  test("rental maps to DSCR 3-yr profit, commission 0 (holds, no sale)", () => {
    const r = computeDualIncome("rental_brrrr", inputs);
    expect(r.basis).toBe("flip_calc:dscr_rental_3yr");
    expect(r.realtorCommission).toBe(0);
    expect(typeof r.investmentReturn).toBe("number");
  });

  test("creative maps to Owner-Finance 3-yr profit, commission 0", () => {
    const r = computeDualIncome("creative", inputs);
    expect(r.basis).toBe("flip_calc:owner_finance_3yr");
    expect(r.realtorCommission).toBe(0);
  });

  test("wholesale / double-close are NOT in the workbook → null ledger", () => {
    const w = computeDualIncome("wholesale", inputs);
    expect(w.investmentReturn).toBeNull();
    expect(w.realtorCommission).toBeNull();
    expect(w.basis).toBe("not_in_workbook");
    expect(computeDualIncome("retail", inputs).investmentReturn).toBeNull();
  });
});
