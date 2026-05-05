/**
 * ListingExtractionService
 *
 * Reads a listing agreement PDF and extracts the timeline + price
 * fields needed to seed a new listing in REOS:
 *   - seller(s) name + contact
 *   - property address
 *   - list price
 *   - list date (effective / commencement)
 *   - listing expiration date
 *   - MLS number (when present in the agreement)
 *
 * Mirrors the pattern in ContractExtractionService (text-first with
 * a Vision fallback for flattened/handwritten forms). Same OpenAI
 * key is used; cost is ~$0.005-0.02 per agreement on gpt-4o-mini.
 */

import { DocumentExtractionService } from "./DocumentExtractionService";
import { renderPdfForVision } from "./PdfRender";

const MODEL = "gpt-4o-mini";
const VISION_MODEL = "gpt-4o";
const MAX_TEXT_CHARS = 18_000;
const MAX_VISION_PAGES = 8;

export interface ListingExtractionField<T = string> {
  value: T | null;
  confidence: number; // 0-1
  snippet: string | null;
}

export interface ListingExtraction {
  sellerName: ListingExtractionField;
  sellerEmail: ListingExtractionField;
  sellerPhone: ListingExtractionField;
  propertyAddress: ListingExtractionField;
  city: ListingExtractionField;
  state: ListingExtractionField;
  zip: ListingExtractionField;
  listPrice: ListingExtractionField<number>;
  listDate: ListingExtractionField;
  listingExpirationDate: ListingExtractionField;
  mlsNumber: ListingExtractionField;
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a real-estate listing-agreement parser.

The document is an EXCLUSIVE RIGHT TO SELL listing agreement (or a
state-equivalent such as a CO LE38, MAR 2008, WAR 1B-WY, GAR F101,
TAR 1101, etc.). Extract the timeline + price fields to JSON.

Rules:
1. Return JSON matching the schema exactly. No prose outside JSON.
2. For every field: { "value": …, "confidence": 0..1, "snippet": "<=140 chars" }
3. If a field is missing or unclear, return { "value": null, "confidence": 0, "snippet": null }.
4. Dates in YYYY-MM-DD. Prices as raw numbers (no currency symbols, no commas).
5. List date = the effective / commencement date the listing begins
   (NOT the date signed if a separate effective date is stated).
6. Listing expiration date = the date the listing terminates if no
   contract has been written. Some forms say "Termination Date".
7. Property address = single address line as written; city/state/zip
   broken out separately when the form provides them.
8. If the agreement has multiple sellers, combine names with " & "
   in sellerName ("John Smith & Jane Smith").

Schema (return EXACTLY these keys):
{
  "sellerName":            field<string>,
  "sellerEmail":           field<string>,
  "sellerPhone":           field<string>,
  "propertyAddress":       field<string>,
  "city":                  field<string>,
  "state":                 field<string>,
  "zip":                   field<string>,
  "listPrice":             field<number>,
  "listDate":              field<string>,    // YYYY-MM-DD
  "listingExpirationDate": field<string>,    // YYYY-MM-DD
  "mlsNumber":             field<string>,
  "notes":                 "string or null — brief note if anything was ambiguous"
}`;

export class ListingExtractionService {
  constructor(private readonly openaiApiKey: string) {}

  async extract(
    buffer: Buffer,
  ): Promise<ListingExtraction & { _path: "text" | "vision" }> {
    const text = await new DocumentExtractionService().extractText(buffer);
    if (text && text.length > 200 && hasListingMarkers(text)) {
      try {
        const ex = await this.extractFromText(text);
        return { ...ex, _path: "text" };
      } catch (err) {
        console.warn(
          "listing text-extraction failed, falling back to vision:",
          err instanceof Error ? err.message : err,
        );
      }
    }
    const ex = await this.extractWithVision(buffer);
    return { ...ex, _path: "vision" };
  }

  private async extractFromText(text: string): Promise<ListingExtraction> {
    const trimmed = text.slice(0, MAX_TEXT_CHARS);
    const userMsg = `Listing agreement text (truncated to ${MAX_TEXT_CHARS} chars if longer):\n\n${trimmed}`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(
        `OpenAI listing text ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("listing text: empty response");
    return JSON.parse(raw) as ListingExtraction;
  }

  private async extractWithVision(buffer: Buffer): Promise<ListingExtraction> {
    const pngs = await renderPdfForVision(buffer, MAX_VISION_PAGES);
    if (pngs.length === 0) throw new Error("listing vision: pdf->png yielded 0 pages");
    const imageContent = pngs.map((b) => ({
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
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Listing agreement rendered as ${pngs.length} page image(s). Extract the schema fields.`,
              },
              ...imageContent,
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(
        `OpenAI listing vision ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("listing vision: empty response");
    return JSON.parse(raw) as ListingExtraction;
  }
}

/** Cheap heuristic: does the text layer look like it contains the
 * markers a listing agreement usually has? Used to short-circuit
 * Vision when the text layer is solid. */
function hasListingMarkers(text: string): boolean {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const m of [
    "listing agreement",
    "exclusive right to sell",
    "list price",
    "expiration",
    "seller",
    "broker",
  ]) {
    if (lower.includes(m)) hits++;
  }
  return hits >= 3;
}
