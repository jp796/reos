import { test, expect, describe } from "bun:test";
import {
  ourSide,
  pickCoAgent,
  computeContactPatch,
  type ExtractedAgent,
} from "./DealContactEnrichmentService";

const agents: ExtractedAgent[] = [
  { name: "Jane Buyer", role: "buyer agent", email: "jane@remax.com", phone: "307-555-1111", brokerage: "RE/MAX", license: "B-100" },
  { name: "Sam Lister", role: "listing agent", email: "sam@kw.com", phone: "307-555-2222", brokerage: "Keller Williams", license: "L-200" },
];

describe("our side", () => {
  test("explicit side wins, else inferred from type", () => {
    expect(ourSide({ side: "buy" })).toBe("buy");
    expect(ourSide({ side: null, transactionType: "seller" })).toBe("sell");
    expect(ourSide({ side: null, transactionType: "buyer" })).toBe("buy");
    expect(ourSide({ side: null, transactionType: "investor" })).toBeNull();
  });
});

describe("co-op agent = the OTHER side", () => {
  test("buy-side deal → listing agent is the co-op agent", () => {
    expect(pickCoAgent(agents, "buy")?.name).toBe("Sam Lister");
  });
  test("sell-side deal → buyer's agent is the co-op agent", () => {
    expect(pickCoAgent(agents, "sell")?.name).toBe("Jane Buyer");
  });
  test("dual / unknown → no single co-op agent", () => {
    expect(pickCoAgent(agents, "both")).toBeNull();
    expect(pickCoAgent(agents, null)).toBeNull();
  });
});

describe("enrich-only patch", () => {
  const empty = {
    coAgentName: null, coAgentBrokerage: null, coAgentPhone: null, coAgentEmail: null, coAgentLicense: null,
    titleCompanyName: null, titleCompanyContact: null, titleCompanyPhone: null, titleCompanyEmail: null,
  };

  test("fills co-op agent flat fields from the other side", () => {
    const patch = computeContactPatch(empty, "buy", { agents, titleCompanyName: "First American" });
    expect(patch).toEqual({
      coAgentName: "Sam Lister",
      coAgentBrokerage: "Keller Williams",
      coAgentPhone: "307-555-2222",
      coAgentEmail: "sam@kw.com",
      coAgentLicense: "L-200",
      titleCompanyName: "First American",
    });
  });

  test("never overwrites a value that's already set", () => {
    const patch = computeContactPatch(
      { ...empty, coAgentName: "Human Edit", titleCompanyName: "Existing Title" },
      "buy",
      { agents, titleCompanyName: "First American" },
    );
    expect(patch.coAgentName).toBeUndefined(); // kept the human edit
    expect(patch.titleCompanyName).toBeUndefined();
    expect(patch.coAgentEmail).toBe("sam@kw.com"); // still fills the empty ones
  });

  test("title email/contact fill from an inbound title email", () => {
    const patch = computeContactPatch(empty, "sell", {
      agents: [],
      titleCompanyEmail: "closer@firstam.com",
      titleCompanyContact: "Dana Closer",
    });
    expect(patch.titleCompanyEmail).toBe("closer@firstam.com");
    expect(patch.titleCompanyContact).toBe("Dana Closer");
  });
});
