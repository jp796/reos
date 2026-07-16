import { test, expect, describe } from "bun:test";
import { getProjectTemplate, projectTasks } from "./projectTemplates";

describe("project templates — JP's exact durations", () => {
  test("wholetail = 2wk work + 1wk make-ready = 21 days", () => {
    const t = getProjectTemplate("wholetail")!;
    expect(t.totalDays).toBe(21);
    expect(t.projectType).toBe("make_ready");
    expect(t.returnsToMarketAs).toBe("sale");
    expect(t.phases.map((p) => p.durationDays)).toEqual([14, 7]);
  });
  test("flip = 60d reno + 1wk make-ready = 67 days", () => {
    const t = getProjectTemplate("flip")!;
    expect(t.totalDays).toBe(67);
    expect(t.projectType).toBe("rehab");
    expect(t.phases.map((p) => p.durationDays)).toEqual([60, 7]);
  });
  test("rental = 2wk work + 30d lease-up + 14d cash-out refi = 58 days, returns as lease", () => {
    const t = getProjectTemplate("rental_brrrr")!;
    expect(t.totalDays).toBe(58);
    expect(t.returnsToMarketAs).toBe("lease");
    expect(t.phases.map((p) => p.key)).toEqual(["rent_ready_work", "lease_up", "cash_out_refinance"]);
    expect(t.phases.map((p) => p.durationDays)).toEqual([14, 30, 14]);
  });
  test("no project template for overlap / retail / creative strategies", () => {
    expect(getProjectTemplate("wholesale")).toBeNull();
    expect(getProjectTemplate("retail")).toBeNull();
    expect(getProjectTemplate("creative")).toBeNull();
  });
});

describe("template task offsets stay within the total window", () => {
  for (const strat of ["wholetail", "flip", "rental_brrrr"] as const) {
    test(`${strat}: every task due offset is within [0, totalDays]`, () => {
      const t = getProjectTemplate(strat)!;
      for (const task of projectTasks(t)) {
        expect(task.dueOffsetDays).toBeGreaterThanOrEqual(0);
        expect(task.dueOffsetDays).toBeLessThanOrEqual(t.totalDays);
      }
    });
  }
});
