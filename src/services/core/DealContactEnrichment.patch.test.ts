import { test, expect, describe } from "bun:test";
import { computeContactPatch, type ExtractedAgent } from "./DealContactEnrichmentService";

const empty = {
  coAgentName: null, coAgentBrokerage: null, coAgentPhone: null, coAgentEmail: null, coAgentLicense: null,
  titleCompanyName: null, titleCompanyContact: null, titleCompanyPhone: null, titleCompanyEmail: null,
  lenderName: null, lenderCompany: null, lenderPhone: null, lenderEmail: null,
};

const agents: ExtractedAgent[] = [
  { name: "Sam Lister", role: "listing agent", email: "sam@kw.com", phone: "307-555-2222", brokerage: "Keller Williams" },
];

describe("lender fields flow through the patch", () => {
  test("fills lender name/company/phone/email enrich-only", () => {
    const patch = computeContactPatch(empty, "buy", {
      agents,
      lenderName: "Pat Loan",
      lenderCompany: "Rocket Mortgage",
      lenderPhone: "800-555-0000",
      lenderEmail: "pat@rocket.com",
    });
    expect(patch.lenderName).toBe("Pat Loan");
    expect(patch.lenderCompany).toBe("Rocket Mortgage");
    expect(patch.lenderPhone).toBe("800-555-0000");
    expect(patch.lenderEmail).toBe("pat@rocket.com");
    // co-op agent still filled alongside
    expect(patch.coAgentName).toBe("Sam Lister");
  });

  test("never overwrites an existing lender value", () => {
    const patch = computeContactPatch(
      { ...empty, lenderName: "Human Edit" },
      "buy",
      { agents: [], lenderName: "Auto Lender", lenderEmail: "auto@x.com" },
    );
    expect(patch.lenderName).toBeUndefined();
    expect(patch.lenderEmail).toBe("auto@x.com");
  });
});
