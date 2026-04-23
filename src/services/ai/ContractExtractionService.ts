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
      return { ...v, _path: "vision" };
    }

    const thin = looksThin(text);
    const textExtraction = await this.extractFromText(text);

    if (!thin) {
      return { ...textExtraction, _path: "text" };
    }

    // Thin text → Vision, then merge (prefer Vision values where
    // confidence is higher).
    try {
      const visionExtraction = await this.extractWithVision(buffer);
      const merged = mergeByConfidence(textExtraction, visionExtraction);
      return { ...merged, _path: "merged" };
    } catch (err) {
      // Vision conversion/call failed — return what we got from text
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`vision fallback failed: ${msg}`);
      return { ...textExtraction, _path: "text" };
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
        max_tokens: 2000,
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
    inspectionObjectionDeadline: asField(o.inspectionObjectionDeadline),
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
    contractStage: asField<"offer" | "counter" | "executed" | "unknown">(
      o.contractStage,
    ),
    buyerSignedAt: asField(o.buyerSignedAt),
    sellerSignedAt: asField(o.sellerSignedAt),
    notes: typeof o.notes === "string" ? o.notes : null,
  };
}
