import { test, expect, describe } from "bun:test";
import {
  commissionRatePoints,
  formatCommissionPct,
  isPlausibleCommissionPoints,
  commissionPairLooksInconsistent,
} from "./commission";

describe("commissionRatePoints — canonical points", () => {
  test("points stay points", () => {
    expect(commissionRatePoints(2.5)).toBe(2.5);
    expect(commissionRatePoints(3)).toBe(3);
    expect(commissionRatePoints(6)).toBe(6);
    expect(commissionRatePoints(1)).toBe(1);
  });
  test("legacy decimal fractions scale to points", () => {
    expect(commissionRatePoints(0.025)).toBe(2.5);
    expect(commissionRatePoints(0.03)).toBe(3);
    expect(commissionRatePoints(0.06)).toBeCloseTo(6, 5);
  });
  test("null / zero / malformed → null", () => {
    expect(commissionRatePoints(null)).toBeNull();
    expect(commissionRatePoints(undefined)).toBeNull();
    expect(commissionRatePoints(0)).toBeNull();
    expect(commissionRatePoints(NaN)).toBeNull();
  });
});

describe("formatCommissionPct — display", () => {
  test("the brief's bug: 0.025 renders 2.5%, never 0.025%", () => {
    expect(formatCommissionPct(0.025)).toBe("2.5%");
    expect(formatCommissionPct(0.025)).not.toBe("0.025%");
  });
  test("standard rates", () => {
    expect(formatCommissionPct(2.5)).toBe("2.5%");
    expect(formatCommissionPct(3)).toBe("3%"); // trailing zeros trimmed
    expect(formatCommissionPct(6)).toBe("6%");
    expect(formatCommissionPct(1)).toBe("1%");
  });
  test("empty for missing", () => {
    expect(formatCommissionPct(null)).toBe("—");
    expect(formatCommissionPct(0)).toBe("—");
  });
});

describe("isPlausibleCommissionPoints — write bounds", () => {
  test("accepts 0..15 points", () => {
    expect(isPlausibleCommissionPoints(2.5)).toBe(true);
    expect(isPlausibleCommissionPoints(0)).toBe(true);
    expect(isPlausibleCommissionPoints(15)).toBe(true);
  });
  test("rejects out-of-range / malformed", () => {
    expect(isPlausibleCommissionPoints(15.1)).toBe(false);
    expect(isPlausibleCommissionPoints(100)).toBe(false); // a decimal typo'd as points
    expect(isPlausibleCommissionPoints(-1)).toBe(false);
    expect(isPlausibleCommissionPoints(NaN)).toBe(false);
  });
});

describe("commissionPairLooksInconsistent — flag, don't rewrite", () => {
  test("the brief's deal is CONSISTENT (amount matches rate×price)", () => {
    // 2.5% of 780,000 = 19,500
    expect(
      commissionPairLooksInconsistent({ ratePoints: 2.5, amount: 19500, price: 780000 }),
    ).toBe(false);
  });
  test("mismatched amount is flagged", () => {
    expect(
      commissionPairLooksInconsistent({ ratePoints: 2.5, amount: 5000, price: 780000 }),
    ).toBe(true);
  });
  test("missing inputs never flag", () => {
    expect(commissionPairLooksInconsistent({ ratePoints: null, amount: 1, price: 1 })).toBe(false);
    expect(commissionPairLooksInconsistent({ ratePoints: 2.5, amount: null, price: 780000 })).toBe(false);
  });
});
