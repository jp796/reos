/**
 * Compliance model for the guided-intake Step 4 (compliance checklist).
 *
 * A flat list of documents needed to stay compliant through closing.
 * Some are AI-suggested (surfaced from the contract — e.g. an HOA rider
 * implies HOA/COA documents); the rest are the standard set every deal
 * carries. The fixture below uses the real 1650 North Ridge Dr deal so
 * the UI is built against something real, not placeholder text.
 */

export interface ComplianceItem {
  id: string;
  name: string;
  description: string;
  /** Surfaced by Atlas from the contract, vs. a standard always-on doc. */
  aiSuggested: boolean;
}

/** Real 1650 North Ridge Dr checklist (AI-suggested docs first). */
export const FIXTURE_COMPLIANCE: ComplianceItem[] = [
  {
    id: "addendum-legal-description",
    name: "Addendum for Legal Description",
    description:
      "An addendum containing the full legal description of the property, as it is not fully described within the main contract.",
    aiSuggested: true,
  },
  {
    id: "brokerage-disclosure",
    name: "Real Estate Brokerage Disclosure",
    description:
      "A document disclosing the agency relationship between the Buyer, Seller, and their respective real estate brokers.",
    aiSuggested: true,
  },
  {
    id: "hoa-coa-documents",
    name: "HOA/COA Documents",
    description:
      "Documents related to the Homeowners Association or Condominium Owners Association, including bylaws, rules, and financial statements, if applicable.",
    aiSuggested: true,
  },
  {
    id: "purchase-agreement",
    name: "Purchase Agreement",
    description:
      "The fully executed contract setting the price, terms, and signatures that bind the Buyer and Seller.",
    aiSuggested: false,
  },
  {
    id: "property-disclosure-statement",
    name: "Property Disclosure Statement",
    description:
      "The Seller's written disclosure of the property's known condition and any material defects.",
    aiSuggested: false,
  },
  {
    id: "title-insurance-commitment",
    name: "Title Insurance Commitment",
    description:
      "The title company's commitment to insure clear title, listing exceptions and requirements to be resolved before closing.",
    aiSuggested: false,
  },
  {
    id: "pre-qualification-letter",
    name: "Pre-Qualification Letter",
    description:
      "The lender's letter confirming the Buyer is qualified to finance the purchase at the agreed amount.",
    aiSuggested: false,
  },
  {
    id: "earnest-money-receipt",
    name: "Earnest Money Receipt",
    description:
      "Proof that the Buyer's earnest money deposit was received and is held in escrow.",
    aiSuggested: false,
  },
  {
    id: "inspection-reports",
    name: "Inspection Reports",
    description:
      "The completed home, roof, and any specialty inspection reports documenting the property's condition.",
    aiSuggested: false,
  },
];
