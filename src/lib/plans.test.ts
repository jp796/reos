import { test, expect, describe } from "bun:test";
import { PLANS, planById, seatLabel, priceLabel, seatLimitReached } from "./plans";

describe("canonical plan config (§14)", () => {
  test("seat labels are consistent + unambiguous", () => {
    expect(seatLabel(planById("solo")!)).toBe("1 user");
    expect(seatLabel(planById("team")!)).toBe("Up to 5 users");
    expect(seatLabel(planById("brokerage")!)).toBe("Unlimited users");
  });
  test("Team is NOT '10' and NOT 'unlimited' — one authoritative value", () => {
    expect(planById("team")!.seats).toBe(5);
  });
  test("price labels", () => {
    expect(priceLabel(planById("solo")!)).toBe("$97/mo");
    expect(priceLabel(planById("team")!)).toBe("$297/mo");
  });
});

describe("server-side seat enforcement matches displayed limit", () => {
  test("team caps at its displayed seat count", () => {
    expect(seatLimitReached("team", 4)).toBe(false);
    expect(seatLimitReached("team", 5)).toBe(true);
    expect(seatLimitReached("team", 6)).toBe(true);
  });
  test("solo caps at 1", () => {
    expect(seatLimitReached("solo", 1)).toBe(true);
  });
  test("brokerage is unlimited", () => {
    expect(seatLimitReached("brokerage", 9999)).toBe(false);
  });
  test("unknown plan never blocks", () => {
    expect(seatLimitReached("nope", 100)).toBe(false);
  });
});

describe("both surfaces share this source", () => {
  test("every plan has a seat rule + at least one feature", () => {
    for (const p of PLANS) {
      expect(p.seats === null || p.seats >= 1).toBe(true);
      expect(p.features.length).toBeGreaterThan(0);
    }
  });
});
