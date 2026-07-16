import { test, expect, describe } from "bun:test";
import {
  workflowFamily,
  workflowLabel,
  hasProjectPhase,
  isOverlapStrategy,
  projectReturnsToMarketAs,
} from "./dealLabels";

describe("workflow family / label", () => {
  test("double-close is wholesale behaviour with a distinct label", () => {
    expect(workflowFamily("wholesale", "assignment")).toBe("wholesale");
    expect(workflowFamily("wholesale", "double_close")).toBe("double_close");
    expect(workflowLabel("wholesale", "double_close")).toBe("Wholesale (double close)");
    expect(workflowLabel("wholesale", "assignment")).toBe("Wholesale (assignment)");
  });
  test("wholetail is its own family/label", () => {
    expect(workflowFamily("wholetail")).toBe("wholetail");
    expect(workflowLabel("wholetail")).toBe("Wholetail");
  });
  test("flip / rental / retail / creative labels", () => {
    expect(workflowLabel("flip")).toBe("Flip");
    expect(workflowLabel("rental_brrrr")).toBe("Rental / BRRRR");
    expect(workflowLabel("retail")).toBe("Retail (agency)");
    expect(workflowLabel("creative")).toBe("Creative finance");
  });
});

describe("project-phase routing", () => {
  test("flip, wholetail, rental have a project phase", () => {
    expect(hasProjectPhase("flip")).toBe(true);
    expect(hasProjectPhase("wholetail")).toBe(true);
    expect(hasProjectPhase("rental_brrrr")).toBe(true);
  });
  test("wholesale / double-close overlap the transaction — no project phase", () => {
    expect(hasProjectPhase("wholesale")).toBe(false);
    expect(isOverlapStrategy("wholesale")).toBe(true);
  });
  test("retail + creative have no project phase and don't overlap", () => {
    expect(hasProjectPhase("retail")).toBe(false);
    expect(hasProjectPhase("creative")).toBe(false);
    expect(isOverlapStrategy("retail")).toBe(false);
  });
  test("returns-to-market: sale for flip/wholetail, lease for rental", () => {
    expect(projectReturnsToMarketAs("flip")).toBe("sale");
    expect(projectReturnsToMarketAs("wholetail")).toBe("sale");
    expect(projectReturnsToMarketAs("rental_brrrr")).toBe("lease");
    expect(projectReturnsToMarketAs("wholesale")).toBeNull();
  });
});
