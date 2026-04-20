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

const MODEL = "gpt-4o-mini";
const MAX_TEXT_CHARS = 24_000; // contracts are usually 10-20 pages / ~20k chars

export interface ContractExtractionField<T = string> {
  value: T | null;
  /** 0-1 confidence from the model; null when field not found */
  confidence: number;
  /** Short snippet from the contract showing the source of this value */
  snippet: string | null;
}

export interface ContractExtraction {
  effectiveDate: ContractExtractionField;
  purchasePrice: ContractExtractionField<number>;
  earnestMoneyAmount: ContractExtractionField<number>;
  earnestMoneyDueDate: ContractExtractionField;
  closingDate: ContractExtractionField;
  possessionDate: ContractExtractionField;
  inspectionDeadline: ContractExtractionField;
  titleObjectionDeadline: ContractExtractionField;
  titleCommitmentDeadline: ContractExtractionField;
  financingDeadline: ContractExtractionField;
  walkthroughDate: ContractExtractionField;
  propertyAddress: ContractExtractionField;
  buyers: ContractExtractionField<string[]>;
  sellers: ContractExtractionField<string[]>;
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
- inspectionDeadline: when buyer must complete inspection / deliver objection notice.
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

On a Rider doc, timeline fields (closingDate, inspectionDeadline, etc.) will mostly be null — that's expected.`;

const SCHEMA_HINT = `{
  "effectiveDate":         { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "purchasePrice":         { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "earnestMoneyAmount":    { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "earnestMoneyDueDate":   { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "closingDate":           { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "possessionDate":        { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "inspectionDeadline":    { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "titleObjectionDeadline":{ "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "titleCommitmentDeadline":{ "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "financingDeadline":     { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "walkthroughDate":       { "value": "YYYY-MM-DD or null", "confidence": 0-1, "snippet": "..." },
  "propertyAddress":       { "value": "street, city state zip", "confidence": 0-1, "snippet": "..." },
  "buyers":                { "value": ["Name1","Name2"], "confidence": 0-1, "snippet": "..." },
  "sellers":               { "value": ["Name1","Name2"], "confidence": 0-1, "snippet": "..." },
  "titleCompanyName":      { "value": "Co name", "confidence": 0-1, "snippet": "..." },
  "lenderName":            { "value": "Lender name", "confidence": 0-1, "snippet": "..." },
  "sellerSideCommissionPct":    { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "sellerSideCommissionAmount": { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "buyerSideCommissionPct":     { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "buyerSideCommissionAmount":  { "value": 0 or null, "confidence": 0-1, "snippet": "..." },
  "compensationOnSeparateRider":{ "value": true or false, "confidence": 0-1, "snippet": "..." },
  "notes":                 "string or null — brief note if anything was ambiguous"
}`;

export class ContractExtractionService {
  constructor(private readonly openaiApiKey: string) {}

  async extract(buffer: Buffer): Promise<ContractExtraction> {
    const text = await new DocumentExtractionService().extractText(buffer);
    if (!text) throw new Error("contract: empty text layer");
    return this.extractFromText(text);
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
        max_tokens: 2000,
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
    titleObjectionDeadline: asField(o.titleObjectionDeadline),
    titleCommitmentDeadline: asField(o.titleCommitmentDeadline),
    financingDeadline: asField(o.financingDeadline),
    walkthroughDate: asField(o.walkthroughDate),
    propertyAddress: asField(o.propertyAddress),
    buyers: asField<string[]>(o.buyers),
    sellers: asField<string[]>(o.sellers),
    titleCompanyName: asField(o.titleCompanyName),
    lenderName: asField(o.lenderName),
    sellerSideCommissionPct: asField<number>(o.sellerSideCommissionPct),
    sellerSideCommissionAmount: asField<number>(o.sellerSideCommissionAmount),
    buyerSideCommissionPct: asField<number>(o.buyerSideCommissionPct),
    buyerSideCommissionAmount: asField<number>(o.buyerSideCommissionAmount),
    compensationOnSeparateRider: asField<boolean>(o.compensationOnSeparateRider),
    notes: typeof o.notes === "string" ? o.notes : null,
  };
}
