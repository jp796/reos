import { test, expect, describe } from "bun:test";
import { qualifiesForWindDown } from "./InvestorWindDownService";

const past = new Date("2026-06-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");
const now = new Date("2026-07-01T00:00:00Z");

const base = {
  newStatus: "pending",
  prevStatus: "active",
  transactionType: "investor",
  representation: null as string | null,
  inspectionDate: past,
  inspectionObjectionDate: null as Date | null,
  now,
};

describe("investor wind-down gating", () => {
  test("investor deal → pending, past inspection → qualifies", () => {
    expect(qualifiesForWindDown(base)).toBe(true);
  });

  test("wholesale + principal also qualify", () => {
    expect(qualifiesForWindDown({ ...base, transactionType: "wholesale" })).toBe(true);
    expect(qualifiesForWindDown({ ...base, transactionType: "other", representation: "principal" })).toBe(true);
  });

  test("retail deal never qualifies", () => {
    expect(qualifiesForWindDown({ ...base, transactionType: "seller", representation: null })).toBe(false);
    expect(qualifiesForWindDown({ ...base, transactionType: "buyer", representation: null })).toBe(false);
  });

  test("only fires on the transition INTO pending", () => {
    expect(qualifiesForWindDown({ ...base, prevStatus: "pending" })).toBe(false); // already pending
    expect(qualifiesForWindDown({ ...base, newStatus: "closed" })).toBe(false);
  });

  test("does NOT fire before the inspection deadline (premature cancel is worse)", () => {
    expect(qualifiesForWindDown({ ...base, inspectionDate: future, inspectionObjectionDate: null })).toBe(false);
  });

  test("no inspection deadline recorded → does not auto-fire", () => {
    expect(qualifiesForWindDown({ ...base, inspectionDate: null, inspectionObjectionDate: null })).toBe(false);
  });

  test("objection deadline takes precedence when present", () => {
    // objection in the future → not yet, even if inspection date is past
    expect(qualifiesForWindDown({ ...base, inspectionDate: past, inspectionObjectionDate: future })).toBe(false);
    expect(qualifiesForWindDown({ ...base, inspectionDate: future, inspectionObjectionDate: past })).toBe(true);
  });
});
