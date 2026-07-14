import { test, expect, describe } from "bun:test";
import { PMT, PV, FV, CUMPRINC } from "./finance";

// Reference values cross-checked against Excel/Google Sheets.
const near = (a: number, b: number, tol = 0.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe("PMT", () => {
  test("standard 30yr mortgage", () => {
    // =PMT(0.06/12, 360, 200000) → -1199.10
    near(PMT(0.06 / 12, 360, 200000), -1199.1);
  });
  test("type=1 (payments at period start) like the sheet's OF loan", () => {
    // =PMT(0.12/12, 360, 100000, 0, 1) → -1018.4283 (= type0 / (1+rate))
    near(PMT(0.12 / 12, 360, 100000, 0, 1), -1018.4283);
  });
  test("zero rate", () => {
    expect(PMT(0, 12, 1200)).toBe(-100);
  });
});

describe("PV", () => {
  test("present value of a payment stream", () => {
    // =PV(0.085/12, 360-36, -1000) → 126835.79
    const v = PV(0.085 / 12, 324, -1000);
    expect(v).toBeGreaterThan(0);
    near(v, 126835.79, 0.5);
  });
  test("zero rate", () => {
    expect(PV(0, 10, -100)).toBe(1000);
  });
});

describe("FV", () => {
  test("appreciation via FV (sheet uses FV(0.03,3,0,ARV))", () => {
    // =FV(0.03, 3, 0, 200000) → -218545.4  (Excel returns negative of grown pv)
    near(FV(0.03, 3, 0, 200000), -218545.4, 1);
    // The sheet does *-1 then subtracts ARV → appreciation profit
    const arv = 200000;
    const appreciation = FV(0.03, 3, 0, arv) * -1 - arv;
    near(appreciation, 18545.4, 1);
  });
});

describe("CUMPRINC", () => {
  test("cumulative principal over first 36 payments of a 30yr loan", () => {
    // =CUMPRINC(0.085/12, 360, 200000, 1, 36, 0) → -4948.51 (principal paid, negative)
    const v = CUMPRINC(0.085 / 12, 360, 200000, 1, 36, 0);
    // The sheet wraps in *-1 to make it positive principal paid down.
    near(v * -1, 4948.51, 0.5);
  });
  test("guards return 0 on bad input", () => {
    expect(CUMPRINC(0, 360, 200000, 1, 36, 0)).toBe(0);
    expect(CUMPRINC(0.05, 360, 0, 1, 36, 0)).toBe(0);
    expect(CUMPRINC(0.05, 360, 200000, 5, 3, 0)).toBe(0);
  });
});
