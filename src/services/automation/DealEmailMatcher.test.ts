import { test, expect, describe } from "bun:test";
import {
  addrKey,
  addressMatches,
  scoreEmailAgainstDeal,
  bestMatch,
  decideAttach,
  type DealCandidate,
} from "./DealEmailMatcher";

const deal = (over: Partial<DealCandidate> = {}): DealCandidate => ({
  id: "d1",
  propertyAddress: "2315 Thomes Ave, Cheyenne WY 82001",
  principalEmails: ["wendy@seller.com"],
  vendorEmails: ["closer@firstamerican.com", "jane@remax.com"],
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

describe("principal sender is the strongest signal (rescues address-less seller mail)", () => {
  test("the deal's seller matches even with a useless subject + no address", () => {
    const m = scoreEmailAgainstDeal(
      { fromEmail: "Wendy@Seller.com", subject: "here you go", bodyText: "See attached." },
      deal(),
    );
    expect(m?.signal).toBe("sender_principal");
    expect(m?.transactionId).toBe("d1");
    expect(m?.confidence).toBeGreaterThan(0.9);
  });
});

describe("vendor sender routes but is weaker than the address", () => {
  test("title-co / co-op sender with no address → sender_vendor", () => {
    const m = scoreEmailAgainstDeal(
      { fromEmail: "Closer@FirstAmerican.com", subject: "Your file", bodyText: "See attached." },
      deal(),
    );
    expect(m?.signal).toBe("sender_vendor");
  });
  test("a vendor email that DOES contain the address matches on address (attachable)", () => {
    const m = scoreEmailAgainstDeal(
      { fromEmail: "closer@firstamerican.com", subject: "docs 2315 Thomes 82001", bodyText: "" },
      deal(),
    );
    expect(m?.signal).toBe("address");
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
  test("principal-sender deal beats an address-only deal", () => {
    const senderDeal = deal({ id: "sender", propertyAddress: "1 Nowhere" });
    const addrDeal = deal({
      id: "addr",
      principalEmails: [],
      vendorEmails: [],
      propertyAddress: "2315 Thomes Ave 82001",
    });
    const m = bestMatch(
      { fromEmail: "wendy@seller.com", subject: "2315 Thomes 82001", bodyText: "" },
      [addrDeal, senderDeal],
    );
    expect(m?.transactionId).toBe("sender");
    expect(m?.signal).toBe("sender_principal");
  });
});

describe("decideAttach — recall without the sender-alone over-attach bug", () => {
  test("address or foldered → attach", () => {
    expect(decideAttach({ signal: "address" }, { foldered: false, senderExclusivePrincipal: false }))
      .toEqual({ attach: true, flagAmbiguous: false });
    expect(decideAttach({ signal: "sender_vendor" }, { foldered: true, senderExclusivePrincipal: false }))
      .toEqual({ attach: true, flagAmbiguous: false });
  });
  test("principal tied to exactly one active deal → attach (fixes Wendy)", () => {
    expect(decideAttach({ signal: "sender_principal" }, { foldered: false, senderExclusivePrincipal: true }))
      .toEqual({ attach: true, flagAmbiguous: false });
  });
  test("principal on multiple active deals → do NOT attach, flag for review", () => {
    expect(decideAttach({ signal: "sender_principal" }, { foldered: false, senderExclusivePrincipal: false }))
      .toEqual({ attach: false, flagAmbiguous: true });
  });
  test("vendor sender alone → never attaches (no over-attach regression)", () => {
    expect(decideAttach({ signal: "sender_vendor" }, { foldered: false, senderExclusivePrincipal: false }))
      .toEqual({ attach: false, flagAmbiguous: false });
  });
});
