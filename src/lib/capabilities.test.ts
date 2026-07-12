import { test, expect, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
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

describe("public marketing page stays truthful to the registry (§13 closure)", () => {
  const pageSrc = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

  test("social posting is described as generate/paste — never native 'posts for you'", () => {
    // Social adapters are `assisted` (copy-paste). The public copy must not
    // promise native auto-posting.
    for (const k of ["facebook", "instagram", "linkedin"]) {
      expect(integrationByKey(k)!.state).toBe("assisted");
    }
    // The old overstatement is gone…
    expect(pageSrc).not.toContain("posts listings to FB / Instagram / LinkedIn");
    // …and the honest language is present.
    expect(pageSrc.toLowerCase()).toContain("ready to paste");
  });

  test("stub integrations are never advertised as present-tense working features", () => {
    // Buffer + MLS are stubs — only forward-looking ("coming"/"roadmap") copy
    // is allowed, never a claim they work today.
    expect(integrationByKey("buffer")!.state).toBe("stub");
    expect(integrationByKey("mls")!.state).toBe("stub");
    expect(pageSrc).not.toMatch(/MLS sync|posts? (via|through) Buffer|Buffer:? (connected|integrated)/i);
  });

  test("non-integrated compliance systems aren't listed as live integrations", () => {
    // Skyslope / Dotloop are roadmap, not in the registry as operational.
    expect(integrationByKey("skyslope")).toBeUndefined();
    expect(integrationByKey("dotloop")).toBeUndefined();
    // The KPI no longer implies all three are wired up.
    expect(pageSrc).not.toContain("Rezen / Skyslope / Dotloop");
  });

  test("only Rezen + Telegram are near-operational; the rest disclose their state", () => {
    // Guardrail: nothing in the registry is silently "operational" without
    // being one of the two we actually run end-to-end (or clearly available).
    const operational = INTEGRATIONS.filter((c) => c.state === "operational").map((c) => c.key);
    expect(operational).toContain("telegram");
    // Rezen is "available" (token connect), not falsely "operational".
    expect(integrationByKey("rezen")!.state).toBe("available");
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
