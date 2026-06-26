/**
 * Review model for the guided-intake Step 2 (split-screen review).
 *
 * A UI-friendly shape: the extracted contract organized into sections of
 * editable fields + entity cards (parties / agents / brokerages /
 * contingencies). An adapter (built when real extraction is wired) maps
 * `ContractExtraction` → ReviewModel; until then the fixture below
 * carries the real 1650 North Ridge Dr data so the UI is built against
 * something real, not placeholder text.
 */

export interface ReviewField {
  id: string;
  label: string;
  value: string;
  /** AI couldn't find it — render the "click to add" missing state. */
  missing?: boolean;
  multiline?: boolean;
}

export interface ReviewEntity {
  id: string;
  name: string;
  /** Role / status badge, e.g. "Buyer", "Listing agent", "Applies". */
  badge?: string;
  fields: ReviewField[];
}

export type ReviewSection =
  | { id: string; title: string; kind: "fields"; fields: ReviewField[] }
  | { id: string; title: string; kind: "entities"; entities: ReviewEntity[] };

export interface ReviewModel {
  address: string;
  /** The anchor date Atlas confirms before computing the timeline. */
  effectiveDate: string;
  sections: ReviewSection[];
}

/** Real 1650 North Ridge Dr data (from the Wyoming/Real contract). */
export const FIXTURE_1650: ReviewModel = {
  address: "1650 North Ridge Dr",
  effectiveDate: "2026-06-16",
  sections: [
    {
      id: "property",
      title: "Property",
      kind: "fields",
      fields: [
        { id: "address", label: "Street address", value: "1650 NORTH RIDGE DR" },
        { id: "city", label: "City", value: "", missing: true },
        { id: "state", label: "State", value: "WY" },
        { id: "zip", label: "Zip code", value: "", missing: true },
        { id: "county", label: "County", value: "Laramie" },
        { id: "hoa", label: "HOA", value: "Yes" },
        { id: "tenant", label: "Tenant occupied", value: "Yes" },
        {
          id: "legal",
          label: "Legal description",
          value:
            "ROCKING STAR RANCH: TRACT 144 PLUS AN UND 1/179 INT IN TRACTS 21, 53, 109, 149 AND 184",
          multiline: true,
        },
      ],
    },
    {
      id: "parties",
      title: "Parties",
      kind: "entities",
      entities: [
        {
          id: "b1",
          name: "Joe T. Carter Jr",
          badge: "Buyer",
          fields: [{ id: "e", label: "Email", value: "jp@titanreteam.com" }],
        },
        {
          id: "b2",
          name: "Sue Ann Carter",
          badge: "Buyer",
          fields: [{ id: "e", label: "Email", value: "jp@titanreteam.com" }],
        },
        {
          id: "s1",
          name: "Brock Towell",
          badge: "Seller",
          fields: [{ id: "e", label: "Email", value: "", missing: true }],
        },
        {
          id: "s2",
          name: "Audrey Towell",
          badge: "Seller",
          fields: [{ id: "e", label: "Email", value: "", missing: true }],
        },
      ],
    },
    {
      id: "agents",
      title: "Agents",
      kind: "entities",
      entities: [
        {
          id: "a1",
          name: "James Fluellen",
          badge: "Buyer agent",
          fields: [
            { id: "br", label: "Brokerage", value: "Real Broker, LLC" },
            { id: "e", label: "Email", value: "jp@titanreteam.com" },
          ],
        },
        {
          id: "a2",
          name: "Rebecca Hess",
          badge: "Listing agent",
          fields: [{ id: "e", label: "Email", value: "", missing: true }],
        },
      ],
    },
    {
      id: "brokerages",
      title: "Brokerages",
      kind: "entities",
      entities: [
        {
          id: "br1",
          name: "Real Broker, LLC",
          badge: "Buyer side",
          fields: [{ id: "lic", label: "License #", value: "", missing: true }],
        },
      ],
    },
    {
      id: "financing",
      title: "Financing summary",
      kind: "fields",
      fields: [
        { id: "type", label: "Financing type", value: "Conventional" },
        { id: "price", label: "Purchase price", value: "$780,000.00" },
        { id: "emd", label: "Earnest money", value: "$7,800.00" },
        { id: "loan", label: "New loan amount", value: "$600,000.00" },
        { id: "balance", label: "Balance due at closing", value: "$172,200.00" },
        { id: "amort", label: "Amortization", value: "30 years" },
        { id: "rate", label: "Interest rate", value: "6%" },
        { id: "pmt", label: "Initial monthly payment", value: "$4,165.55" },
      ],
    },
    {
      id: "terms",
      title: "Terms & contingencies",
      kind: "entities",
      entities: [
        {
          id: "c-fin",
          name: "Financing contingency",
          badge: "Applies",
          fields: [
            {
              id: "d",
              label: "",
              value:
                "Buyer must obtain a conventional loan. A pre-qualification letter is due by June 18, 2026. Closing can be extended by 15 banking days if loan processing is delayed.",
              multiline: true,
            },
          ],
        },
        {
          id: "c-appr",
          name: "Appraisal contingency",
          badge: "Applies",
          fields: [
            {
              id: "d",
              label: "",
              value:
                "If an appraisal is required for financing and determines the value is less than the purchase price, parties can reduce price, negotiate, or void the contract.",
              multiline: true,
            },
          ],
        },
        {
          id: "c-insp",
          name: "Investigation / inspection contingency",
          badge: "Applies",
          fields: [
            {
              id: "d",
              label: "",
              value:
                "Buyer has until June 30, 2026, 11:59 p.m. to provide written notice of defects. If repairs are not agreed upon, Buyer can void the contract by July 3, 2026, 8:00 p.m.",
              multiline: true,
            },
          ],
        },
        {
          id: "c-roof",
          name: "Roof inspection contingency",
          badge: "Applies",
          fields: [
            {
              id: "d",
              label: "",
              value:
                "A licensed roofer must inspect the roof at Buyer's expense. Seller is responsible for necessary repairs to ensure insurable condition and at least a 3-year life expectancy.",
              multiline: true,
            },
          ],
        },
        {
          id: "c-view",
          name: "Property viewing contingency",
          badge: "Applies",
          fields: [
            {
              id: "d",
              label: "",
              value:
                "Buyer has 7 calendar days from mutual acceptance to view and verify the property. Buyer can terminate if not acceptable by providing written notice within this period.",
              multiline: true,
            },
          ],
        },
        {
          id: "c-title",
          name: "Title / preliminary report review",
          badge: "Applies",
          fields: [
            {
              id: "d",
              label: "",
              value:
                "Seller will provide a title insurance commitment. Buyer has 5 Business Days from receipt to notify Seller of any title defects.",
              multiline: true,
            },
          ],
        },
        {
          id: "c-disc",
          name: "Property disclosure contingency",
          badge: "Applies",
          fields: [
            {
              id: "d",
              label: "",
              value:
                "Buyer has not received the Property Disclosure at the time of the offer, implying it must be provided and reviewed.",
              multiline: true,
            },
          ],
        },
        {
          id: "c-ins",
          name: "Insurance contingency",
          badge: "Applies",
          fields: [
            {
              id: "d",
              label: "",
              value:
                "Buyer must investigate and obtain a written commitment for adequate property and liability insurance prior to the objection deadline.",
              multiline: true,
            },
          ],
        },
      ],
    },
  ],
};

/** Count of fields flagged missing across the whole model. */
export function countMissing(model: ReviewModel): number {
  let n = 0;
  for (const s of model.sections) {
    if (s.kind === "fields") {
      n += s.fields.filter((f) => f.missing).length;
    } else {
      for (const e of s.entities) n += e.fields.filter((f) => f.missing).length;
    }
  }
  return n;
}
