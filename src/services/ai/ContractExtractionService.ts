/**
 * ContractExtractionService
 *
 * Given a purchase-contract PDF buffer, extract the timeline-critical
 * fields: parties, property, purchase price, effective date, every
 * deadline (earnest money, inspection, title objection, financing,
 * walkthrough), closing + possession.
 *
 * Strategy:
 *   1. Extract text via pdf-parse (reuses DocumentExtractionService)
 *   2. Feed the full text to GPT-4o-mini with a strict JSON schema
 *      asking for each field + source snippet + confidence
 *
 * Why AI vs regex:
 *   - Contract formats vary wildly state-by-state (WAR, MAR, TREC,
 *     CAR, GAR, TAR each have different layouts + deadline phrasing)
 *   - Many contracts ship as flattened PDFs where filled values
 *     appear as loose text blocks detached from their labels, which
 *     positional regex can't reliably pair
 *   - GPT-4o-mini at ~$0.15/M input tokens is ~$0.01 per full
 *     contract — cheap enough to run on every new transaction
 *
 * The SS closing-date + financials extractors remain regex-only —
 * those PDFs have reliable anchors per template and don't need AI.
 */

import { DocumentExtractionService } from "./DocumentExtractionService";
import { renderPdfForVision } from "./PdfRender";
import { addBusinessDays, addCalendarDays } from "@/lib/business-days";

const MODEL = "gpt-4o-mini";
const VISION_MODEL = "gpt-4o"; // vision requires full 4o, not mini
const MAX_TEXT_CHARS = 24_000; // contracts are usually 10-20 pages / ~20k chars
const MAX_VISION_PAGES = 12; // cap image uploads per contract to hold cost down

export interface ContractExtractionField<T = string> {
  value: T | null;
  /** 0-1 confidence from the model; null when field not found */
  confidence: number;
  /** Short snippet from the contract showing the source of this value */
  snippet: string | null;
}

/**
 * A structured party (buyer or seller) with per-person contact info
 * when the contract states it. The richer view alongside the legacy
 * `buyers` / `sellers` string[] fields, which stay for backward compat.
 */
export interface ContractParty {
  name: string;
  role: "buyer" | "seller";
  email: string | null;
  phone: string | null;
}

/**
 * A real-estate agent / licensee named in the contract. `role`
 * describes which side or function (e.g. "buyer agent",
 * "listing agent", "transaction coordinator").
 */
export interface ContractAgent {
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  brokerage: string | null;
  license: string | null;
}

/**
 * A brokerage / firm named in the contract. `side` is which side it
 * represents (e.g. "buyer", "listing").
 */
export interface ContractBrokerage {
  name: string;
  side: string;
  license: string | null;
  address: string | null;
}

/**
 * A contingency or contractual term (financing, appraisal, inspection,
 * title review, disclosures, insurance, HOA, sale-of-other-property,
 * etc.). `description` carries the FULL descriptive text verbatim-ish;
 * `status` is "applies" | "waived" | "n/a" (free-form, model-supplied);
 * `deadline` is an ISO YYYY-MM-DD date when one is stated, else null.
 */
export interface ContractContingency {
  name: string;
  status: string;
  description: string;
  deadline: string | null;
}

export interface ContractExtraction {
  effectiveDate: ContractExtractionField;
  purchasePrice: ContractExtractionField<number>;
  earnestMoneyAmount: ContractExtractionField<number>;
  earnestMoneyDueDate: ContractExtractionField;
  closingDate: ContractExtractionField;
  possessionDate: ContractExtractionField;
  /** Deadline for the buyer to COMPLETE inspections. */
  inspectionDeadline: ContractExtractionField;
  /** Deadline for the buyer to OBJECT in writing to inspection results.
   * Different from inspectionDeadline in most state contracts
   * (e.g. WY: inspect-by + a separate objection-by a few days later). */
  inspectionObjectionDeadline: ContractExtractionField;
  titleObjectionDeadline: ContractExtractionField;
  titleCommitmentDeadline: ContractExtractionField;
  financingDeadline: ContractExtractionField;
  walkthroughDate: ContractExtractionField;
  propertyAddress: ContractExtractionField;
  buyers: ContractExtractionField<string[]>;
  sellers: ContractExtractionField<string[]>;

  // ── Property details (ListedKit-grade enrichment) ──
  /** City portion of the subject property address. */
  city: ContractExtractionField;
  /** State portion of the subject property address (e.g. "WY", "MO"). */
  state: ContractExtractionField;
  /** ZIP / postal code of the subject property. */
  zip: ContractExtractionField;
  /** County the subject property sits in. */
  county: ContractExtractionField;
  /** Legal description of the property, captured verbatim. */
  legalDescription: ContractExtractionField;
  /** Whether the property is subject to an HOA. */
  hoa: ContractExtractionField<boolean>;
  /** Whether the property is currently tenant-occupied. */
  tenantOccupied: ContractExtractionField<boolean>;

  // ── Financing summary (ListedKit-grade enrichment) ──
  /** Financing type, e.g. "Conventional" | "FHA" | "VA" | "USDA" |
   *  "Cash" | "Seller Financing" | "Other". */
  financingType: ContractExtractionField;
  /** Loan amount in raw dollars (e.g. 360000). */
  loanAmount: ContractExtractionField<number>;
  /** Balance due at closing in raw dollars. */
  balanceDueAtClosing: ContractExtractionField<number>;
  /** Loan amortization term in years (e.g. 30). */
  loanAmortizationYears: ContractExtractionField<number>;
  /** Interest rate as a decimal (e.g. 0.06 for 6%). */
  interestRate: ContractExtractionField<number>;
  /** Monthly payment in raw dollars. */
  monthlyPayment: ContractExtractionField<number>;

  // ── Structured parties / agents / brokerages (ListedKit-grade) ──
  /** Richer per-party view capturing email/phone when present. The
   *  legacy `buyers` / `sellers` string[] fields remain authoritative
   *  for name-only consumers; this adds contact detail without
   *  replacing them. */
  partyDetails: ContractExtractionField<ContractParty[]>;
  /** Every agent / licensee named in the contract, with role + contact
   *  + brokerage + license when stated. */
  agents: ContractExtractionField<ContractAgent[]>;
  /** Every brokerage / firm named, with side + license + address. */
  brokerages: ContractExtractionField<ContractBrokerage[]>;

  // ── Contingencies / terms (ListedKit-grade — most important) ──
  /** Every contingency / term present in the contract, each with its
   *  full descriptive text, status, and deadline when stated. */
  contingencies: ContractExtractionField<ContractContingency[]>;

  titleCompanyName: ContractExtractionField;
  lenderName: ContractExtractionField;
  /** Compensation (when stated in the contract — Wyoming + some state forms do this) */
  sellerSideCommissionPct: ContractExtractionField<number>;
  sellerSideCommissionAmount: ContractExtractionField<number>;
  buyerSideCommissionPct: ContractExtractionField<number>;
  buyerSideCommissionAmount: ContractExtractionField<number>;
  /**
   * Whether compensation appears to be on a SEPARATE rider/addendum
   * rather than this main contract. If true (e.g. Missouri RES-2000),
   * the UI nudges the user to also upload the compensation rider.
   */
  compensationOnSeparateRider: ContractExtractionField<boolean>;
  /** Contract lifecycle stage based on signatures found in the PDF:
   *   "offer"    — buyer-only signature, or no signatures yet (draft)
   *   "counter"  — seller added counter-terms (one-sided counter)
   *   "executed" — BOTH buyer and seller signed (binding)
   *   "unknown"  — couldn't determine
   */
  contractStage: ContractExtractionField<
    "offer" | "counter" | "executed" | "unknown"
  >;
  buyerSignedAt: ContractExtractionField<string>;
  sellerSignedAt: ContractExtractionField<string>;

  // ── Relative deadlines (the fix for "scan isn't pulling dates") ──
  // Many state contracts (WY, and others) express deadlines as
  // OFFSETS from the Effective Date rather than absolute dates:
  //   "within 5 business days of the Effective Date"
  //   "10 Business Days after the Effective Date to inspect"
  // The model returns null for the absolute field because there's no
  // absolute date in the document. We extract the offset here and
  // COMPUTE the absolute date from effectiveDate (see
  // computeRelativeDeadlines). unit "business" skips weekends.
  /** Days the buyer has to deposit earnest money, from Effective Date. */
  earnestMoneyDueDays: ContractExtractionField<number>;
  earnestMoneyDueUnit: ContractExtractionField<"business" | "calendar">;
  /** Length of the inspection period, from Effective Date. */
  inspectionPeriodDays: ContractExtractionField<number>;
  inspectionPeriodUnit: ContractExtractionField<"business" | "calendar">;
  /** Days to deliver written inspection objections, from the END of
   *  the inspection period (or Effective Date if the form says so). */
  inspectionObjectionDays: ContractExtractionField<number>;
  inspectionObjectionUnit: ContractExtractionField<"business" | "calendar">;
  /** Days for the seller to deliver the title commitment, from the
   *  Effective Date (e.g. "10 Business Days after mutual acceptance"). */
  titleCommitmentDays: ContractExtractionField<number>;
  titleCommitmentUnit: ContractExtractionField<"business" | "calendar">;
  /** Days to object to title, from receipt of the title commitment.
   *  Computed off the title-commitment deadline when that is known. */
  titleObjectionDays: ContractExtractionField<number>;
  titleObjectionUnit: ContractExtractionField<"business" | "calendar">;
  /** Days to secure financing, from Effective Date. */
  financingDeadlineDays: ContractExtractionField<number>;
  financingDeadlineUnit: ContractExtractionField<"business" | "calendar">;

  /** Non-empty only on partial / low-confidence extractions */
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a contract-analysis assistant for a real estate agent.
The document is either (a) a residential purchase contract or (b) a
compensation agreement rider. Extract fields per the JSON schema.

GENERAL RULES
1. Return JSON matching the schema exactly. No prose outside JSON.
2. For every field: { "value": ..., "confidence": 0..1, "snippet": "<=160 chars from source" }.
3. If a field is missing or not applicable, return { "value": null, "confidence": 0, "snippet": null }.
4. Never invent values. If a deadline is computed (e.g. "5 business days after acceptance"),
   show the math in the snippet and only fill value if the effective date is known.
5. Prices = raw numbers (444000 not "$444,000"). Percents = decimal (0.03 not 3 not "3%").
6. Dates = ISO YYYY-MM-DD when a specific calendar date is known; else null.
7. buyers / sellers = arrays of full names exactly as written.

FIELD-SPECIFIC GUIDANCE
- effectiveDate: look for the "dated" clause at the top of the contract
  ("OFFER TO PURCHASE dated ____" or "Contract made this ___ day of ___").
  Distinct from signature dates at the bottom.
- closingDate: the final transfer date — usually phrased "Closing shall occur on or before [DATE]"
  or "Closing Date ___". NOT the title commitment deadline, NOT the inspection deadline.
- titleCommitmentDeadline: when the title company must deliver the title commitment
  ("title insurance commitment to Buyer no later than ___").
- inspectionDeadline: DATE BY WHICH the buyer must COMPLETE physical inspections (home inspection, radon, sewer scope, etc.). Labels vary: "Inspection Objection Deadline", "Inspection Period Expires", "Inspection Period End", "Right to Inspect Deadline".
- inspectionObjectionDeadline: DATE BY WHICH the buyer must DELIVER WRITTEN OBJECTIONS to the seller. Usually 1-3 days AFTER the inspection completion deadline but MAY be the same day in some WY / CO forms. Look for "Inspection Notice Deadline", "Objection Notice", "Notice of Unsatisfactory Inspection", "Inspection Termination Notice Deadline". If the contract only has a single combined "inspection objection" date, put it in BOTH this field AND inspectionDeadline.
- titleObjectionDeadline: when buyer must object to title exceptions — often a few days
  AFTER the titleCommitmentDeadline.
- walkthroughDate: often tied to closing ("on or before day of closing").
- possessionDate: can be "at closing" = closingDate, or "72 hours after closing", or a named date.

COMPENSATION
Many Wyoming WAR contracts state commissions inline. Missouri MAR RES-2000 contracts state
compensation on a SEPARATE Compensation Rider. If you see a 1-2 page doc titled
"Compensation Agreement Rider" (or similar), set compensationOnSeparateRider.value=true
AND fill the compensation fields from the rider.

For compensation look for:
  - "Seller Compensation to Buyer Broker" with $ or % (buyerSideCommission*)
  - "Listing Broker" / "Seller's Broker" compensation with $ or % (sellerSideCommission*)
  - Phrases like "3% of the Purchase Price" → buyerSideCommissionPct = 0.03
  - Phrases like "$10,000 to Buyer Broker" → buyerSideCommissionAmount = 10000
Both pct AND amount may appear; extract whichever is provided.

On a Rider doc, timeline fields (closingDate, inspectionDeadline, etc.) will mostly be null — that's expected.

PROPERTY DETAILS
- city / state / zip / county: pull from the property/legal-description block. state as the 2-letter code when written that way. county only when the contract states it (often in the legal description or title section).
- legalDescription: capture the FULL legal description verbatim (lot/block/subdivision/plat or metes-and-bounds). Do not summarize.
- hoa (boolean): true if the contract indicates the property is in a homeowners association (HOA dues, HOA addendum, HOA disclosure, association name). false if it explicitly says no HOA. null when unstated.
- tenantOccupied (boolean): true if the property is described as leased / tenant-occupied / subject to existing tenancy. false if owner-occupied or vacant is stated. null when unstated.

FINANCING SUMMARY
- financingType: one of "Conventional", "FHA", "VA", "USDA", "Cash", "Seller Financing", or "Other". If the contract says "all cash" / "no financing contingency", use "Cash".
- loanAmount: the principal loan amount in raw dollars (e.g. 360000).
- balanceDueAtClosing: cash/balance the buyer brings at closing, raw dollars, when stated.
- loanAmortizationYears: amortization term in years (e.g. 30, 15).
- interestRate: as a DECIMAL (0.06 for 6%, 0.065 for 6.5%). Use a stated rate or a stated maximum/not-to-exceed rate; null if only "prevailing market rate".
- monthlyPayment: stated monthly payment (principal+interest, or PITI if that's what's given), raw dollars.

STRUCTURED PARTIES (partyDetails)
- partyDetails is an ARRAY. One object per buyer AND one per seller, capturing per-person contact info when present:
  { "name": "...", "role": "buyer"|"seller", "email": "...|null", "phone": "...|null" }
- Keep names identical to how they appear in buyers/sellers. Pull email/phone from signature blocks, contact lines, or notice sections when shown; null when not present. Never invent contact info.

AGENTS (agents)
- agents is an ARRAY of every agent / licensee named anywhere in the contract (signature blocks, broker info sections, "Prepared by ___" lines, notice/contact pages):
  { "name": "...", "role": "...", "email": "...|null", "phone": "...|null", "brokerage": "...|null", "license": "...|null" }
- DETERMINE role by WHICH PARTY the agent represents — do NOT guess or default:
  * An agent in the buyer's-broker block, the buyer's signature / notice block, or a "Prepared by [Name] | [Brokerage]" line on a BUYER'S OFFER represents the buyer → role = "buyer agent".
  * An agent in the listing / seller's-broker block or the seller's signature / notice block → role = "listing agent".
  * Closing / escrow / coordinator contacts → "transaction coordinator" or "closing agent".
- A purchase OFFER frequently names ONLY the buyer's agent + brokerage; the listing / seller side is often blank at offer stage. If the seller's agent or listing brokerage is NOT in the document, do NOT invent one — and NEVER relabel the buyer's agent as the listing agent to fill the gap.
- Pull license numbers and brokerage names when stated; null otherwise.

BROKERAGES (brokerages)
- brokerages is an ARRAY of every brokerage / firm named:
  { "name": "...", "side": "...", "license": "...|null", "address": "...|null" }
- side = which party the firm represents: the brokerage on the buyer's "Prepared by" / buyer-broker line = "buyer"; the listing brokerage = "listing". Do not guess — if only one brokerage is named (typical on a buyer's offer), label it by the side it actually represents and omit the other rather than fabricating a listing brokerage.

CONTINGENCIES / TERMS (contingencies) — MOST IMPORTANT NEW SECTION
- contingencies is an ARRAY. Capture EVERY contingency and material term present in the contract — do NOT collapse to yes/no. Each entry:
  { "name": "...", "status": "applies"|"waived"|"n/a", "description": "<full descriptive text, verbatim-ish, 1-3 sentences>", "deadline": "YYYY-MM-DD or null" }
- Capture at minimum, when present: financing, appraisal, investigation/inspection, roof inspection, property viewing, title/preliminary-report review, property disclosure, insurance, HOA, sale-of-other-property — AND any other contingency or term the contract contains.
- BE EXHAUSTIVE. A typical residential purchase contract contains 6-10 contingencies / material terms. Walk the contract SECTION BY SECTION and emit one entry for EVERY numbered or lettered provision that creates a buyer or seller right, deadline, condition, or obligation (inspection, title, financing, appraisal, insurance, disclosures, HOA, survey, possession, default/remedies, etc.). If your contingencies list has fewer than 5 entries, you are under-reading — re-scan the document and add the ones you missed.
- status: "applies" when the contingency is in effect, "waived" when the buyer/seller has waived it, "n/a" when the form lists it but marks it not applicable.
- description: the FULL descriptive text of the contingency from the contract, verbatim-ish (1-3 sentences). Do NOT shorten to a label.
- deadline: ISO YYYY-MM-DD only when a specific date is stated for that contingency; otherwise null (a relative offset goes in the description, not here).

RELATIVE DEADLINES — CRITICAL
Many contracts DO NOT state absolute deadline dates. They state OFFSETS from the Effective Date, e.g.:
  "within 5 business days of the Effective Date" (earnest money)
  "Buyer shall have 10 Business Days after the Effective Date to inspect" (inspection period)
  "10 business days after receipt of the title commitment" (title objection)
  "secure financing within 21 days of the Effective Date" (financing)
When the absolute date field is null because the contract only gives an offset, ALSO fill the matching relative-offset field so REOS can compute the date:
  - earnestMoneyDueDays / earnestMoneyDueUnit  ("business" or "calendar")
  - inspectionPeriodDays / inspectionPeriodUnit
  - inspectionObjectionDays / inspectionObjectionUnit
  - titleCommitmentDays / titleCommitmentUnit  ("deliver the title commitment N Business Days after mutual acceptance")
  - titleObjectionDays / titleObjectionUnit  ("within N Business Days of receipt of the title commitment")
  - financingDeadlineDays / financingDeadlineUnit
Set unit to "business" when the text says "business days", else "calendar". Always extract BOTH the absolute date (if stated) and the offset (if stated). One contract may have some absolute and some relative — fill whatever each field is.

CONTRACT STAGE (executed vs. offer vs. counter)
Check the signature pages at the end of the document:
  - If BOTH a buyer signature AND a seller signature are present (with
    dates or signed-at stamps, or Dotloop/DocuSign signer-completed
    markers) → contractStage="executed"
  - If only one side has signed (typically buyer) → "offer"
  - If the document has "Counter" / "Counteroffer" headings or a
    counter-terms section AND seller signed but buyer has not re-signed
    → "counter"
  - If you can't tell → "unknown"

Populate buyerSignedAt and sellerSignedAt with ISO dates from the signature
blocks when present.`;

const SCHEMA_HINT = `{
  "effectiveDate":         { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "purchasePrice":         { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "earnestMoneyAmount":    { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "earnestMoneyDueDate":   { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "closingDate":           { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "possessionDate":        { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "inspectionDeadline":    { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "inspectionObjectionDeadline": { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "titleObjectionDeadline":{ "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "titleCommitmentDeadline":{ "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "financingDeadline":     { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "walkthroughDate":       { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "propertyAddress":       { "value": "street, city state zip", "confidence": 0-1, "snippet": "..." },
  "buyers":                { "value": ["Name1","Name2"], "confidence": 0-1, "snippet": "..." },
  "sellers":               { "value": ["Name1","Name2"], "confidence": 0-1, "snippet": "..." },
  "city":                  { "value": "city or null", "confidence": 0-1, "snippet": "..." },
  "state":                 { "value": "ST or null", "confidence": 0-1, "snippet": "..." },
  "zip":                   { "value": "zip or null", "confidence": 0-1, "snippet": "..." },
  "county":                { "value": "county or null", "confidence": 0-1, "snippet": "..." },
  "legalDescription":      { "value": "full legal description verbatim or null", "confidence": 0-1, "snippet": "..." },
  "hoa":                   { "value": true or false or null, "confidence": 0-1, "snippet": "..." },
  "tenantOccupied":        { "value": true or false or null, "confidence": 0-1, "snippet": "..." },
  "financingType":         { "value": "Conventional|FHA|VA|USDA|Cash|Seller Financing|Other or null", "confidence": 0-1, "snippet": "..." },
  "loanAmount":            { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "balanceDueAtClosing":   { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "loanAmortizationYears": { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "interestRate":          { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "monthlyPayment":        { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "partyDetails":          { "value": [{ "name": "...", "role": "buyer|seller", "email": "...|null", "phone": "...|null" }], "confidence": 0-1, "snippet": "..." },
  "agents":                { "value": [{ "name": "...", "role": "buyer agent|listing agent|transaction coordinator", "email": "...|null", "phone": "...|null", "brokerage": "...|null", "license": "...|null" }], "confidence": 0-1, "snippet": "..." },
  "brokerages":            { "value": [{ "name": "...", "side": "buyer|listing", "license": "...|null", "address": "...|null" }], "confidence": 0-1, "snippet": "..." },
  "contingencies":         { "value": [{ "name": "...", "status": "applies|waived|n/a", "description": "full descriptive text", "deadline": "YYYY-MM-DD or null" }], "confidence": 0-1, "snippet": "..." },
  "titleCompanyName":      { "value": "Co name", "confidence": 0-1, "snippet": "..." },
  "lenderName":            { "value": "Lender name", "confidence": 0-1, "snippet": "..." },
  "sellerSideCommissionPct":    { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "sellerSideCommissionAmount": { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "buyerSideCommissionPct":     { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "buyerSideCommissionAmount":  { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "compensationOnSeparateRider":{ "value": true or false, "confidence": 0-1, "snippet": "..." },
  "contractStage":         { "value": "offer|counter|executed|unknown", "confidence": 0-1, "snippet": "..." },
  "buyerSignedAt":         { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "sellerSignedAt":        { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "earnestMoneyDueDays":   { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "earnestMoneyDueUnit":   { "value": "business|calendar", "confidence": 0-1, "snippet": "..." },
  "inspectionPeriodDays":  { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "inspectionPeriodUnit":  { "value": "business|calendar", "confidence": 0-1, "snippet": "..." },
  "inspectionObjectionDays":{ "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "inspectionObjectionUnit":{ "value": "business|calendar", "confidence": 0-1, "snippet": "..." },
  "titleCommitmentDays":   { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "titleCommitmentUnit":   { "value": "business|calendar", "confidence": 0-1, "snippet": "..." },
  "titleObjectionDays":    { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "titleObjectionUnit":    { "value": "business|calendar", "confidence": 0-1, "snippet": "..." },
  "financingDeadlineDays": { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "financingDeadlineUnit": { "value": "business|calendar", "confidence": 0-1, "snippet": "..." },
  "notes":                 "string or null — brief note if anything was ambiguous"
}`;

export class ContractExtractionService {
  constructor(private readonly openaiApiKey: string) {}

  /**
   * Main entry point. Tries text extraction first; if the text layer
   * looks "thin" (i.e. filled form values weren't baked in — the
   * Dotloop / DocuSign flattened-to-graphics case), falls back to
   * GPT-4o Vision on rendered page images.
   *
   * Returns the extraction plus which path ran, for audit.
   */
  async extract(
    buffer: Buffer,
  ): Promise<ContractExtraction & { _path: "text" | "vision" | "merged" }> {
    const text = await new DocumentExtractionService().extractText(buffer);
    if (!text) {
      const v = await this.extractWithVision(buffer);
      return { ...computeRelativeDeadlines(v), _path: "vision" };
    }

    const thin = looksThin(text);
    const textExtraction = await this.extractFromText(text);

    // Outcome-based fallback. The `looksThin` regex guesses whether
    // the text layer is complete, but it's wrong for flattened PDFs
    // whose text layer has template boilerplate dates/dollars
    // (thin=false) yet is MISSING the filled timeline values that
    // live only in graphic overlays. So: if the critical dates didn't
    // come back, treat the text layer as incomplete REGARDLESS of the
    // heuristic and let Vision try.
    //
    // BUT: if the dates are missing because the contract states them
    // as RELATIVE offsets (5 business days after Effective Date), the
    // offsets came back instead — Vision reads the same words and
    // won't find absolute dates that don't exist. Skip the wasteful
    // Vision call; computeRelativeDeadlines() handles those.
    // Skip Vision only when the missing dates are explained by RELATIVE
    // offsets we can actually compute — which requires an effective date
    // to anchor them. Offsets with NO effective date still need Vision
    // (to read the acceptance date or the absolute filled-in dates).
    const canComputeFromOffsets =
      hasRelativeOffsets(textExtraction) &&
      textExtraction.effectiveDate?.value != null;
    const criticalMissing =
      criticalTimelineMissing(textExtraction) && !canComputeFromOffsets;

    if (!thin && !criticalMissing) {
      return { ...computeRelativeDeadlines(textExtraction), _path: "text" };
    }

    try {
      const visionExtraction = await this.extractWithVision(buffer);
      const merged = mergeByConfidence(textExtraction, visionExtraction);
      return { ...computeRelativeDeadlines(merged), _path: "merged" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`vision fallback failed: ${msg}`);
      return { ...computeRelativeDeadlines(textExtraction), _path: "text" };
    }
  }

  /**
   * Render the PDF to PNG pages and feed them to GPT-4o Vision
   * alongside the same schema. Used when the text layer is thin
   * (e.g. Dotloop / DocuSign-flattened PDFs where filled values
   * are burned into graphics).
   */
  async extractWithVision(buffer: Buffer): Promise<ContractExtraction> {
    const pngBuffers = await renderPdfForVision(buffer, MAX_VISION_PAGES);
    if (pngBuffers.length === 0) throw new Error("vision: pdf->png yielded 0 pages");

    const imageContent = pngBuffers.map((b) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:image/png;base64,${b.toString("base64")}`,
        detail: "high" as const,
      },
    }));

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 8000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `This is a signed contract PDF rendered as ${pngBuffers.length} images (pages 1..${pngBuffers.length}). Extract the fields per the schema below. Filled form values may appear as handwritten-style overlays over the underlying template. Read the OVERLAID values (what's filled in), not the template labels.

Return JSON matching this schema:
${SCHEMA_HINT}`,
              },
              ...imageContent,
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI vision ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("OpenAI vision returned empty body");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OpenAI vision non-JSON: ${raw.slice(0, 200)}`);
    }
    return normalize(parsed);
  }

  /**
   * Extract from already-rasterized images (e.g. phone PHOTOS of a
   * contract sent over Telegram) — feeds the image bytes straight to
   * GPT-4o Vision, skipping the PDF→PNG render that extractWithVision
   * does. Returns the same shape as extract(), with relative deadlines
   * computed.
   */
  async extractFromImages(
    imageBuffers: Buffer[],
  ): Promise<ContractExtraction & { _path: "vision" }> {
    if (imageBuffers.length === 0) throw new Error("extractFromImages: no images");
    const imageContent = imageBuffers.slice(0, MAX_VISION_PAGES).map((b) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:image/jpeg;base64,${b.toString("base64")}`,
        detail: "high" as const,
      },
    }));
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 8000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `These ${imageBuffers.length} image(s) are photos of a signed real-estate contract. Read the filled-in values and extract per the schema:\n${SCHEMA_HINT}`,
              },
              ...imageContent,
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI vision ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("OpenAI vision returned empty body");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OpenAI vision non-JSON: ${raw.slice(0, 200)}`);
    }
    return { ...computeRelativeDeadlines(normalize(parsed)), _path: "vision" };
  }

  async extractFromText(text: string): Promise<ContractExtraction> {
    const trimmed = text.slice(0, MAX_TEXT_CHARS);
    const userMsg = `Contract text (truncated to ${MAX_TEXT_CHARS} chars if longer):

"""
${trimmed}
"""

Return JSON matching this schema:
${SCHEMA_HINT}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 8000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("OpenAI returned empty body");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OpenAI returned non-JSON: ${raw.slice(0, 200)}`);
    }
    return normalize(parsed);
  }
}

/**
 * The timeline fields that matter most for transaction coordination —
 * the ones JP flagged as "not pulling." When the text pass returns
 * null for these, the text layer is almost certainly incomplete and
 * we should let Vision try, regardless of the looksThin heuristic.
 *
 * effectiveDate is excluded: a Rider / amendment legitimately has no
 * timeline, and effectiveDate alone being null isn't diagnostic. We
 * trigger on the operational deadlines that a real executed purchase
 * contract WILL contain.
 */
function criticalTimelineMissing(ex: ContractExtraction): boolean {
  // If a Rider (compensation-only) doc, timeline emptiness is expected —
  // don't burn a Vision call.
  const isRider = ex.compensationOnSeparateRider?.value === true;
  if (isRider) return false;
  const deadlines: Array<ContractExtractionField<unknown>> = [
    ex.inspectionDeadline,
    ex.inspectionObjectionDeadline,
    ex.financingDeadline,
    ex.earnestMoneyDueDate,
  ];
  const deadlinesPresent = deadlines.filter((f) => f && f.value != null).length;
  // Escalate to Vision when the text pass didn't capture the timeline:
  //   - no closing date (a real purchase contract always has one), OR
  //   - no effective/acceptance date (the anchor for every deadline), OR
  //   - the filled deadline set is largely empty (<2 of 4).
  // Flattened WY WAR / Dotloop contracts put the CLAUSES in the text
  // layer but the FILLED-IN date values in graphic overlays — so
  // closing+price can come back via text while every deadline stays
  // null. That is still an incomplete extraction and MUST hit Vision.
  return (
    ex.closingDate?.value == null ||
    ex.effectiveDate?.value == null ||
    deadlinesPresent < 2
  );
}

/** True when the extraction captured any relative-deadline offset —
 *  i.e. the contract states deadlines as "N days after Effective
 *  Date" rather than absolute dates. Used to skip a pointless Vision
 *  retry (Vision reads the same words and finds the same offsets). */
function hasRelativeOffsets(ex: ContractExtraction): boolean {
  return [
    ex.earnestMoneyDueDays,
    ex.inspectionPeriodDays,
    ex.inspectionObjectionDays,
    ex.financingDeadlineDays,
    ex.titleObjectionDays,
  ].some((f) => f && typeof f.value === "number");
}

/**
 * Heuristic: does the extracted text contain enough filled-in content
 * to run purely-textual extraction, or should we fall back to Vision?
 *
 * A Dotloop/DocuSign-flattened contract will have lots of placeholder
 * patterns ($________ with nothing filled). A properly baked-in
 * contract will have dollar amounts like "$317,000.00" present.
 */
function looksThin(text: string): boolean {
  const placeholderCount = (text.match(/[_]{5,}/g) ?? []).length;
  const dollarFilled = (text.match(/\$[\s]?[\d,]{3,}(?:\.\d{2})?/g) ?? []).length;
  const longDates = (text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/g) ?? []).length;
  const numericDates = (text.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g) ?? []).length;
  const dateHits = longDates + numericDates;
  const ratio = placeholderCount / Math.max(1, dollarFilled + dateHits);

  // Thresholds tuned against WY WAR (flattened values baked into text,
  // ratio ~0.5) vs MO RES-2000 (Dotloop-flattened, ratio 10+):
  // - Very high placeholder-to-filled ratio => Vision
  // - Very few filled values at all => Vision
  if (placeholderCount >= 10 && ratio >= 4) return true;
  if (dollarFilled === 0 && dateHits <= 3 && placeholderCount >= 5) return true;
  if (dollarFilled === 0 && dateHits === 0) return true;
  return false;
}

/**
 * When both text and vision extractions ran, keep whichever field
 * value has higher confidence. Ties go to vision (more likely to
 * have seen actual filled values).
 */
function mergeByConfidence(
  t: ContractExtraction,
  v: ContractExtraction,
): ContractExtraction {
  const keys = Object.keys(t) as Array<keyof ContractExtraction>;
  const out = {} as ContractExtraction;
  for (const k of keys) {
    if (k === "notes") {
      (out as unknown as { notes: string | null }).notes = v.notes ?? t.notes;
      continue;
    }
    const tf = t[k] as ContractExtractionField<unknown>;
    const vf = v[k] as ContractExtractionField<unknown>;
    // prefer non-null; if both present, prefer higher confidence (tie → vision)
    const pick =
      vf.value !== null && (tf.value === null || vf.confidence >= tf.confidence)
        ? vf
        : tf;
    (out as unknown as Record<string, unknown>)[k] = pick;
  }
  return out;
}

/**
 * Merge several contract extractions into one, NEWEST-effective-date
 * wins per field. This is the offer + counter-offer (+ addenda) case:
 * the base offer supplies every deadline, and a later document overrides
 * only the fields it actually restates (price, closing, EM). A counter
 * offer read alone is mostly null by design — it points back to the base
 * for the timeline — so merging is the only way to get a full picture.
 *
 * Each input should already have computeRelativeDeadlines applied. The
 * caller re-runs computeRelativeDeadlines + deriveWalkthrough on the
 * merged result so a changed effective/closing date recomputes cleanly.
 */
export function mergeExtractionsByRecency(
  list: ContractExtraction[],
): ContractExtraction {
  const docs = list.filter(Boolean);
  if (docs.length === 0) {
    throw new Error("mergeExtractionsByRecency: no extractions to merge");
  }
  if (docs.length === 1) return docs[0];

  // oldest → newest by effectiveDate (missing date sorts oldest, so a
  // dated document always wins over an undated one).
  const ordered = [...docs].sort((a, b) => {
    const da = (a.effectiveDate?.value as string) ?? "";
    const db = (b.effectiveDate?.value as string) ?? "";
    return da.localeCompare(db);
  });

  const keys = Object.keys(ordered[0]) as Array<keyof ContractExtraction>;
  const out = { ...ordered[0] } as ContractExtraction;
  for (let i = 1; i < ordered.length; i++) {
    const doc = ordered[i];
    for (const k of keys) {
      if (k === "notes") {
        const nxt = (doc as unknown as { notes: string | null }).notes;
        if (nxt) (out as unknown as { notes: string | null }).notes = nxt;
        continue;
      }
      const nf = doc[k] as ContractExtractionField<unknown> | undefined;
      // A newer document's field wins only when it actually carries a
      // value — otherwise the base offer's value is preserved.
      if (nf && nf.value !== null && nf.value !== "") {
        (out as unknown as Record<string, unknown>)[k] = nf;
      }
    }
  }
  return out;
}

/**
 * When the contract doesn't state a final-walkthrough date, derive it
 * as 24 hours before closing — the standard convention. Only fills when
 * the walkthrough is empty and closing is known; marked low-confidence
 * with a "derived" snippet so the UI can show it's inferred, not read.
 */
export function deriveWalkthrough(
  ex: ContractExtraction,
): ContractExtraction {
  const wt = ex.walkthroughDate?.value as string | null;
  const closing = ex.closingDate?.value as string | null;
  if (!closing) return ex;
  // Set the final walkthrough to 24h before closing when it's unstated,
  // OR when the contract only says "on/before the day of closing" (so the
  // model returned the closing date itself) — a walkthrough belongs the
  // day before, not on closing day.
  const needsDerive =
    wt === null || wt === undefined || wt === "" || wt >= closing;
  if (needsDerive) {
    const d = new Date(`${closing}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() - 1);
      return {
        ...ex,
        walkthroughDate: {
          value: d.toISOString().slice(0, 10),
          confidence: 0.5,
          snippet: "derived: 24h before closing",
        },
      };
    }
  }
  return ex;
}

function asField<T = string>(v: unknown): ContractExtractionField<T> {
  if (!v || typeof v !== "object") {
    return { value: null, confidence: 0, snippet: null };
  }
  const o = v as Record<string, unknown>;
  const value = o.value === undefined ? null : (o.value as T | null);
  const confidence =
    typeof o.confidence === "number"
      ? Math.max(0, Math.min(1, o.confidence))
      : 0;
  const snippet =
    typeof o.snippet === "string" && o.snippet.trim()
      ? o.snippet.trim().slice(0, 240)
      : null;
  return { value, confidence, snippet };
}

/**
 * Array-safe variant of asField. Returns a ContractExtractionField
 * whose value is the parsed-and-validated array, or null when the
 * model returned no usable array. Each element is run through
 * `mapItem`, which returns a typed object or null (null elements are
 * dropped). An empty result array collapses to value=null so callers
 * can treat "no items" identically to "field absent", consistent with
 * the scalar `asField` null pattern.
 */
function asArrayField<T>(
  v: unknown,
  mapItem: (raw: Record<string, unknown>) => T | null,
): ContractExtractionField<T[]> {
  if (!v || typeof v !== "object") {
    return { value: null, confidence: 0, snippet: null };
  }
  const o = v as Record<string, unknown>;
  const confidence =
    typeof o.confidence === "number"
      ? Math.max(0, Math.min(1, o.confidence))
      : 0;
  const snippet =
    typeof o.snippet === "string" && o.snippet.trim()
      ? o.snippet.trim().slice(0, 240)
      : null;

  const rawValue = o.value;
  if (!Array.isArray(rawValue)) {
    return { value: null, confidence, snippet };
  }
  const items: T[] = [];
  for (const el of rawValue) {
    if (!el || typeof el !== "object") continue;
    const mapped = mapItem(el as Record<string, unknown>);
    if (mapped !== null) items.push(mapped);
  }
  return { value: items.length > 0 ? items : null, confidence, snippet };
}

/** Coerce an unknown to a trimmed non-empty string, else null. */
function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function mapParty(o: Record<string, unknown>): ContractParty | null {
  const name = asStr(o.name);
  if (!name) return null; // a party with no name is unusable
  const role = o.role === "seller" ? "seller" : "buyer";
  return { name, role, email: asStr(o.email), phone: asStr(o.phone) };
}

function mapAgent(o: Record<string, unknown>): ContractAgent | null {
  const name = asStr(o.name);
  if (!name) return null;
  return {
    name,
    role: asStr(o.role) ?? "",
    email: asStr(o.email),
    phone: asStr(o.phone),
    brokerage: asStr(o.brokerage),
    license: asStr(o.license),
  };
}

function mapBrokerage(o: Record<string, unknown>): ContractBrokerage | null {
  const name = asStr(o.name);
  if (!name) return null;
  return {
    name,
    side: asStr(o.side) ?? "",
    license: asStr(o.license),
    address: asStr(o.address),
  };
}

function mapContingency(
  o: Record<string, unknown>,
): ContractContingency | null {
  const name = asStr(o.name);
  const description = asStr(o.description);
  // A contingency entry is only meaningful with a name or a description.
  if (!name && !description) return null;
  return {
    name: name ?? "",
    status: asStr(o.status) ?? "",
    description: description ?? "",
    deadline: asStr(o.deadline),
  };
}

function normalize(parsed: unknown): ContractExtraction {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  return {
    effectiveDate: asField(o.effectiveDate),
    purchasePrice: asField<number>(o.purchasePrice),
    earnestMoneyAmount: asField<number>(o.earnestMoneyAmount),
    earnestMoneyDueDate: asField(o.earnestMoneyDueDate),
    closingDate: asField(o.closingDate),
    possessionDate: asField(o.possessionDate),
    inspectionDeadline: asField(o.inspectionDeadline),
    inspectionObjectionDeadline: asField(o.inspectionObjectionDeadline),
    titleObjectionDeadline: asField(o.titleObjectionDeadline),
    titleCommitmentDeadline: asField(o.titleCommitmentDeadline),
    financingDeadline: asField(o.financingDeadline),
    walkthroughDate: asField(o.walkthroughDate),
    propertyAddress: asField(o.propertyAddress),
    buyers: asField<string[]>(o.buyers),
    sellers: asField<string[]>(o.sellers),
    city: asField(o.city),
    state: asField(o.state),
    zip: asField(o.zip),
    county: asField(o.county),
    legalDescription: asField(o.legalDescription),
    hoa: asField<boolean>(o.hoa),
    tenantOccupied: asField<boolean>(o.tenantOccupied),
    financingType: asField(o.financingType),
    loanAmount: asField<number>(o.loanAmount),
    balanceDueAtClosing: asField<number>(o.balanceDueAtClosing),
    loanAmortizationYears: asField<number>(o.loanAmortizationYears),
    interestRate: asField<number>(o.interestRate),
    monthlyPayment: asField<number>(o.monthlyPayment),
    partyDetails: asArrayField<ContractParty>(o.partyDetails, mapParty),
    agents: asArrayField<ContractAgent>(o.agents, mapAgent),
    brokerages: asArrayField<ContractBrokerage>(o.brokerages, mapBrokerage),
    contingencies: asArrayField<ContractContingency>(
      o.contingencies,
      mapContingency,
    ),
    titleCompanyName: asField(o.titleCompanyName),
    lenderName: asField(o.lenderName),
    sellerSideCommissionPct: asField<number>(o.sellerSideCommissionPct),
    sellerSideCommissionAmount: asField<number>(o.sellerSideCommissionAmount),
    buyerSideCommissionPct: asField<number>(o.buyerSideCommissionPct),
    buyerSideCommissionAmount: asField<number>(o.buyerSideCommissionAmount),
    compensationOnSeparateRider: asField<boolean>(o.compensationOnSeparateRider),
    contractStage: asField<"offer" | "counter" | "executed" | "unknown">(
      o.contractStage,
    ),
    buyerSignedAt: asField(o.buyerSignedAt),
    sellerSignedAt: asField(o.sellerSignedAt),
    earnestMoneyDueDays: asField<number>(o.earnestMoneyDueDays),
    earnestMoneyDueUnit: asField<"business" | "calendar">(o.earnestMoneyDueUnit),
    inspectionPeriodDays: asField<number>(o.inspectionPeriodDays),
    inspectionPeriodUnit: asField<"business" | "calendar">(o.inspectionPeriodUnit),
    inspectionObjectionDays: asField<number>(o.inspectionObjectionDays),
    inspectionObjectionUnit: asField<"business" | "calendar">(o.inspectionObjectionUnit),
    titleCommitmentDays: asField<number>(o.titleCommitmentDays),
    titleCommitmentUnit: asField<"business" | "calendar">(o.titleCommitmentUnit),
    titleObjectionDays: asField<number>(o.titleObjectionDays),
    titleObjectionUnit: asField<"business" | "calendar">(o.titleObjectionUnit),
    financingDeadlineDays: asField<number>(o.financingDeadlineDays),
    financingDeadlineUnit: asField<"business" | "calendar">(o.financingDeadlineUnit),
    notes: typeof o.notes === "string" ? o.notes : null,
  };
}

/**
 * Fill absolute deadline dates from extracted relative offsets +
 * the Effective Date. This is the fix for contracts that express
 * deadlines as "N business days after the Effective Date" — the
 * model returns null for the absolute field (correctly, there's no
 * date in the doc), and we compute it here.
 *
 * Only fills a field that's still null AND has both an offset and an
 * anchor. Computed values get confidence 0.7 and a snippet noting it
 * was derived, so the UI shows the amber "verify" dot. When the
 * Effective Date itself is missing, nothing computes — the caller
 * surfaces "enter the Effective Date to auto-fill deadlines."
 *
 * Anchors:
 *   earnest money / inspection / financing / title commitment → Effective Date
 *   inspection objection → end of inspection period (so it stacks)
 *   title objection → title-commitment deadline (so it stacks)
 */
export function computeRelativeDeadlines(
  ex: ContractExtraction,
): ContractExtraction {
  const effRaw = ex.effectiveDate?.value;
  if (!effRaw) return ex; // no anchor → nothing to compute
  const effective = new Date(`${effRaw}T00:00:00`);
  if (Number.isNaN(effective.getTime())) return ex;

  const out = { ...ex };
  const derive = (anchor: Date, days: number, unit: string): string => {
    const d =
      unit === "business" ? addBusinessDays(anchor, days) : addCalendarDays(anchor, days);
    return d.toISOString().slice(0, 10);
  };
  const computed = (iso: string, fromLabel: string): ContractExtractionField => ({
    value: iso,
    confidence: 0.7,
    snippet: `computed: ${fromLabel}`,
  });

  // Earnest money
  if (
    out.earnestMoneyDueDate.value == null &&
    typeof out.earnestMoneyDueDays.value === "number"
  ) {
    const unit = out.earnestMoneyDueUnit.value === "calendar" ? "calendar" : "business";
    out.earnestMoneyDueDate = computed(
      derive(effective, out.earnestMoneyDueDays.value, unit),
      `${out.earnestMoneyDueDays.value} ${unit} days from Effective Date`,
    );
  }

  // Inspection period end (the inspection deadline)
  let inspectionEnd: Date | null = null;
  if (
    out.inspectionDeadline.value == null &&
    typeof out.inspectionPeriodDays.value === "number"
  ) {
    const unit = out.inspectionPeriodUnit.value === "calendar" ? "calendar" : "business";
    const iso = derive(effective, out.inspectionPeriodDays.value, unit);
    inspectionEnd = new Date(`${iso}T00:00:00`);
    out.inspectionDeadline = computed(
      iso,
      `${out.inspectionPeriodDays.value} ${unit} days from Effective Date`,
    );
  } else if (out.inspectionDeadline.value) {
    inspectionEnd = new Date(`${out.inspectionDeadline.value}T00:00:00`);
  }

  // Inspection objection — anchored to end of inspection period
  if (
    out.inspectionObjectionDeadline.value == null &&
    typeof out.inspectionObjectionDays.value === "number" &&
    inspectionEnd &&
    !Number.isNaN(inspectionEnd.getTime())
  ) {
    const unit =
      out.inspectionObjectionUnit.value === "calendar" ? "calendar" : "business";
    out.inspectionObjectionDeadline = computed(
      derive(inspectionEnd, out.inspectionObjectionDays.value, unit),
      `${out.inspectionObjectionDays.value} ${unit} days after inspection period`,
    );
  }

  // Financing
  if (
    out.financingDeadline.value == null &&
    typeof out.financingDeadlineDays.value === "number"
  ) {
    const unit =
      out.financingDeadlineUnit.value === "calendar" ? "calendar" : "business";
    out.financingDeadline = computed(
      derive(effective, out.financingDeadlineDays.value, unit),
      `${out.financingDeadlineDays.value} ${unit} days from Effective Date`,
    );
  }

  // Title commitment — anchored to Effective Date ("deliver the title
  // commitment N Business Days after mutual acceptance").
  let titleCommitmentEnd: Date | null = null;
  if (
    out.titleCommitmentDeadline.value == null &&
    typeof out.titleCommitmentDays.value === "number"
  ) {
    const unit =
      out.titleCommitmentUnit.value === "calendar" ? "calendar" : "business";
    const iso = derive(effective, out.titleCommitmentDays.value, unit);
    titleCommitmentEnd = new Date(`${iso}T00:00:00`);
    out.titleCommitmentDeadline = computed(
      iso,
      `${out.titleCommitmentDays.value} ${unit} days from Effective Date`,
    );
  } else if (out.titleCommitmentDeadline.value) {
    titleCommitmentEnd = new Date(`${out.titleCommitmentDeadline.value}T00:00:00`);
  }

  // Title objection — anchored to the title-commitment deadline ("within
  // N Business Days of receipt of the title commitment"). Now computable
  // because titleCommitmentEnd is known above.
  if (
    out.titleObjectionDeadline.value == null &&
    typeof out.titleObjectionDays.value === "number" &&
    titleCommitmentEnd &&
    !Number.isNaN(titleCommitmentEnd.getTime())
  ) {
    const unit =
      out.titleObjectionUnit.value === "calendar" ? "calendar" : "business";
    out.titleObjectionDeadline = computed(
      derive(titleCommitmentEnd, out.titleObjectionDays.value, unit),
      `${out.titleObjectionDays.value} ${unit} days after title commitment`,
    );
  }

  return out;
}
