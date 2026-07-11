import { test, expect, describe } from "bun:test";
import {
  INTEGRATIONS,
  integrationByKey,
  classifyForm,
  requiresConversion,
  CAPABILITY_LABEL,
} from "./capabilities";

describe("integration capability truthfulness (§13)", () => {
  test("social adapters are labeled assisted/stub, not operational", () => {
    for (const k of ["facebook", "instagram", "linkedin"]) {
      expect(integrationByKey(k)!.state).toBe("assisted");
    }
    expect(integrationByKey("buffer")!.state).toBe("stub");
    expect(integrationByKey("mls")!.state).toBe("stub");
  });
  test("Rezen discloses MFA limitation", () => {
    expect(integrationByKey("rezen")!.note.toLowerCase()).toContain("mfa");
  });
  test("no stub is labeled 'Connected'", () => {
    for (const c of INTEGRATIONS) {
      if (c.state === "stub") expect(CAPABILITY_LABEL[c.state]).not.toBe("Connected");
    }
  });
});

describe("forms never present XFA as Atlas-fillable (§13)", () => {
  test("XFA is not atlas-fillable + needs conversion", () => {
    const xfa = classifyForm("xfa");
    expect(xfa.atlasFillable).toBe(false);
    expect(requiresConversion("xfa")).toBe(true);
    expect(xfa.workflow.toLowerCase()).toContain("flatten");
  });
  test("fillable + flat PDFs are atlas-fillable", () => {
    expect(classifyForm("fillable_pdf").atlasFillable).toBe(true);
    expect(classifyForm("flat_pdf").atlasFillable).toBe(true);
    expect(requiresConversion("fillable_pdf")).toBe(false);
  });
  test("unsupported never fillable", () => {
    expect(classifyForm("unsupported").atlasFillable).toBe(false);
    expect(requiresConversion("unsupported")).toBe(true);
  });
});
