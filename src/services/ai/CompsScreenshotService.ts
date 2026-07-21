/**
 * CompsScreenshotService
 *
 * Reads a screenshot of MLS SOLD comparable listings and extracts
 * the comparable rows needed by the flip calculator:
 *   - address
 *   - sold / closed price
 *   - living-area square feet
 *   - beds
 *   - baths
 *   - sold date as printed
 *
 * Mirrors the vision-call pattern used by the other extraction
 * services, but this input is already a raw image, so no PDF render
 * step is needed before sending it to GPT-4o.
 */

import { env } from "@/lib/env";

export interface ExtractedComp {
  address: string | null;
  salePrice: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  soldDate: string | null;
}

const SYSTEM_PROMPT = `You are reading a screenshot of MLS comparable SOLD listings. Extract each comparable row. Return JSON { comps: ExtractedComp[] }. Use the SOLD/CLOSED price, never the list price. Living-area square feet only (exclude lot size). If a value is not clearly legible, return null for it — do NOT guess or infer. Ignore the subject property if present; only return comparables.

Rules:
1. Return JSON only. No prose outside JSON.
2. Cap the result at 10 comparable rows.
3. If the top-level object uses a wrapper, keep the rows under "comps".
4. Null means unclear, missing, or illegible. Never infer.

Schema:
{
  "comps": [
    {
      "address": "string | null",
      "salePrice": "number | null",
      "sqft": "number | null",
      "beds": "number | null",
      "baths": "number | null",
      "soldDate": "string | null"
    }
  ]
}`;

const USER_PROMPT = `Extract up to 10 SOLD comparable rows from this MLS screenshot.

Return JSON matching:
{
  "comps": [
    {
      "address": "string | null",
      "salePrice": "number | null",
      "sqft": "number | null",
      "beds": "number | null",
      "baths": "number | null",
      "soldDate": "string | null"
    }
  ]
}

Use only the SOLD/CLOSED price. Use living-area square feet only. Return null for any unclear field. Ignore the subject property if present.`;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class CompsScreenshotService {
  constructor(private readonly openaiApiKey: string) {}

  async extract(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<ExtractedComp[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          temperature: 0,
          response_format: { type: "json_object" },
          max_tokens: 3000,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: USER_PROMPT },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${imageBuffer.toString("base64")}`,
                    detail: "high",
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI vision ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) throw new Error("comps vision: empty response");

      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("comps vision: top-level JSON object required");
      }

      return normalizeComps(parsed);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function extractCompsFromImage(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<ExtractedComp[]> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return new CompsScreenshotService(env.OPENAI_API_KEY).extract(
    imageBuffer,
    mimeType,
  );
}

function normalizeComps(raw: unknown): ExtractedComp[] {
  const obj = raw as Record<string, unknown>;
  const unwrapped = obj.comps ?? obj.rows ?? obj.data ?? obj;
  const rows = Array.isArray(unwrapped) ? unwrapped : [];
  const out: ExtractedComp[] = [];

  for (const row of rows) {
    try {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const src = row as Record<string, unknown>;

      const salePrice = coerceNumber(src.salePrice);
      const sqft = coerceNumber(src.sqft);

      const comp: ExtractedComp = {
        address: coerceString(src.address),
        salePrice: salePrice !== null && salePrice <= 0 ? null : salePrice,
        sqft: sqft !== null && sqft <= 0 ? null : sqft,
        beds: coerceNumber(src.beds),
        baths: coerceNumber(src.baths),
        soldDate: coerceString(src.soldDate),
      };

      if (comp.salePrice === null && comp.sqft === null) continue;
      out.push(comp);
    } catch {
      continue;
    }
  }

  return out.slice(0, 10);
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/[$,\s]/g, "");
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
