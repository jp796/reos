import { test, expect, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
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

describe("public marketing page shares the canonical seat limit (§14 closure)", () => {
  const pageSrc = readFileSync(
    join(process.cwd(), "src/app/page.tsx"),
    "utf8",
  );

  test("public page derives pricing from src/lib/plans (no hardcoded copy)", () => {
    expect(pageSrc).toContain('from "@/lib/plans"');
    // Renders the authoritative seat line + iterates the canonical list.
    expect(pageSrc).toContain("seatLabel(plan)");
    expect(pageSrc).toContain("PLANS.map");
  });

  test("public page no longer claims Team is unlimited", () => {
    // The exact stale strings that caused the drift bug must be gone.
    expect(pageSrc).not.toContain("Multi-user (unlimited)");
    expect(pageSrc).not.toContain("Unlimited users. Charge only kicks in");
  });

  test("the Team seat limit the public page renders == server enforcement", () => {
    const team = planById("team")!;
    // What the public card shows for Team…
    const publicSeatClaim = seatLabel(team); // "Up to 5 users"
    // …must be the same 5 the server blocks the 6th seat on.
    expect(publicSeatClaim).toBe("Up to 5 users");
    expect(seatLimitReached("team", team.seats!)).toBe(true);
    expect(seatLimitReached("team", team.seats! - 1)).toBe(false);
    // And only the truly-unlimited plan reads as unlimited on both.
    expect(seatLabel(planById("brokerage")!)).toBe("Unlimited users");
  });
});
