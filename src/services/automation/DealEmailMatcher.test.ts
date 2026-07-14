import { test, expect, describe } from "bun:test";
import {
  addrKey,
  addressMatches,
  scoreEmailAgainstDeal,
  bestMatch,
  type DealCandidate,
} from "./DealEmailMatcher";

const deal = (over: Partial<DealCandidate> = {}): DealCandidate => ({
  id: "d1",
  propertyAddress: "2315 Thomes Ave, Cheyenne WY 82001",
  knownEmails: ["closer@firstamerican.com", "jane@remax.com"],
  partyNames: ["Deborah Ridley", "Elite Property Solutions"],
  ...over,
});

describe("address keying", () => {
  test("pulls street number + zip", () => {
    expect(addrKey("2315 Thomes Ave, Cheyenne WY 82001")).toEqual({ streetNum: "2315", zip: "82001" });
  });
  test("matches address in email text tolerant of formatting", () => {
    expect(addressMatches("2315 Thomes Ave, Cheyenne WY 82001", "Closing docs for 2315 Thomes Avenue 82001")).toBe(true);
    expect(addressMatches("2315 Thomes Ave, Cheyenne WY 82001", "Re: 404 Main St 82082")).toBe(false);
  });
});

describe("sender email is the strongest signal (rescues address-less mail)", () => {
  test("title-co / co-op sender matches even with a useless subject", () => {
    const m = scoreEmailAgainstDeal(
      { fromEmail: "Closer@FirstAmerican.com", subject: "Your file", bodyText: "See attached." },
      deal(),
    );
    expect(m?.signal).toBe("sender_email");
    expect(m?.transactionId).toBe("d1");
    expect(m?.confidence).toBeGreaterThan(0.9);
  });
});

describe("falls back to address, then party name", () => {
  test("address match when sender unknown", () => {
    const m = scoreEmailAgainstDeal(
      { fromEmail: "random@nobody.com", subject: "docs 2315 Thomes 82001", bodyText: "" },
      deal(),
    );
    expect(m?.signal).toBe("address");
  });
  test("party-name match as last resort", () => {
    const m = scoreEmailAgainstDeal(
      { fromEmail: "random@nobody.com", subject: "update", bodyText: "Regarding Deborah Ridley's sale" },
      deal(),
    );
    expect(m?.signal).toBe("party_name");
  });
  test("no signal → null", () => {
    expect(
      scoreEmailAgainstDeal({ fromEmail: "x@y.com", subject: "hi", bodyText: "nothing" }, deal()),
    ).toBeNull();
  });
});

describe("bestMatch picks the highest-confidence deal", () => {
  test("sender-email deal beats an address-only deal", () => {
    const senderDeal = deal({ id: "sender", propertyAddress: "1 Nowhere" });
    const addrDeal = deal({ id: "addr", knownEmails: [], propertyAddress: "2315 Thomes Ave 82001" });
    const m = bestMatch(
      { fromEmail: "jane@remax.com", subject: "2315 Thomes 82001", bodyText: "" },
      [addrDeal, senderDeal],
    );
    expect(m?.transactionId).toBe("sender");
    expect(m?.signal).toBe("sender_email");
  });
});
