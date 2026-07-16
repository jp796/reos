import { test, expect, describe } from "bun:test";
import { getStrategyTemplate } from "./strategyTemplates";
import { getProjectTemplate } from "./projectTemplates";

/**
 * FLAG 1: the project-phase middle (Rehab / Prep-to-List / Renovations /
 * Lease-Up / Refinance) must live ONLY in the Project templates — never in the
 * flat strategyTemplates — so a deal's rehab work can't double-up.
 */

const PROJECT_PHASE_STAGE_KEYS = [
  "rehab",
  "prep_to_list",
  "renovations",
  "lease_up",
  "refinance",
];

describe("flat strategy templates no longer carry the project-phase middle", () => {
  test("flip flat lifecycle is acquisition-only (no rehab/prep/on-market/pending/sold)", () => {
    const keys = getStrategyTemplate("flip").map((s) => s.key);
    expect(keys).toEqual(["potential", "under_contract_purchase"]);
  });

  test("rental flat lifecycle keeps acquisition + Under Management, drops the middle", () => {
    const keys = getStrategyTemplate("rental_brrrr").map((s) => s.key);
    expect(keys).toContain("under_management");
    expect(keys).not.toContain("renovations");
    expect(keys).not.toContain("lease_up");
    expect(keys).not.toContain("refinance");
  });

  test("no flat lifecycle for any strategy still contains a project-phase stage", () => {
    for (const strat of ["flip", "wholetail", "rental_brrrr", "wholesale", "creative", "retail"] as const) {
      const keys = getStrategyTemplate(strat).map((s) => s.key);
      for (const removed of PROJECT_PHASE_STAGE_KEYS) {
        expect(keys).not.toContain(removed);
      }
    }
  });
});

describe("the middle is fully covered by the Project templates (no gap)", () => {
  test("flip's rehab + make-ready live in the flip project template", () => {
    const t = getProjectTemplate("flip")!;
    expect(t.phases.map((p) => p.key)).toEqual(["renovation", "make_ready"]);
  });
  test("rental's reno + lease-up + refinance live in the rental project template", () => {
    const t = getProjectTemplate("rental_brrrr")!;
    expect(t.phases.map((p) => p.key)).toEqual(["rent_ready_work", "lease_up", "cash_out_refinance"]);
  });
});
