/**
 * ChecklistVisionService
 *
 * Reads brokerage compliance-checklist screenshots and extracts a
 * structured slot list. Used by the onboarding wizard so a new
 * brokerage owner can drop screenshots from their transaction
 * software (Skyslope, Dotloop, Rezen, Lone Wolf, in-house portal,
 * etc.) and REOS builds a BrokerageChecklist from them — no manual
 * data entry.
 *
 * Backed by GPT-4o (Vision) — accurate on tabular UI screenshots.
 */

const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";

const SYSTEM_PROMPT = `You extract real-estate compliance checklists from screenshots.

You'll receive 1+ screenshots of a brokerage's transaction-software checklist
(Rezen, Skyslope, Dotloop, Lone Wolf, KW Command, in-house portals, etc.).

Output ONLY a JSON object:
{
  "kind": "transaction" | "listing",
  "slots": [
    {
      "number": 1,
      "label": "Accepted Contract/Counters",
      "required": "required" | "if_applicable",
      "tag": "cda" | "closing_docs" | "termination" | null
    },
    ...
  ]
}

Rules:
- Number = the literal slot number shown in the UI (1-based).
- Label = the exact slot name as written, no abbreviation.
- "required" = the toggle/badge says Required / Yes / mandatory.
  "if_applicable" = If Applic / Optional / If Applicable.
- "tag" = the small badge under the slot if any (CDA, Closing Docs,
  Termination). null when no badge.
- Determine kind from the page header (e.g. "Listing Checklist" vs
  "Transaction Checklist").
- Skip rows that are clearly UI chrome (search bar, header).
- Be conservative — if a row is ambiguous, omit it rather than guess.`;

export interface ParsedSlot {
  number: number;
  label: string;
  required: "required" | "if_applicable";
  tag: "cda" | "closing_docs" | "termination" | null;
}
export interface ParseResult {
  kind: "transaction" | "listing";
  slots: ParsedSlot[];
}

export async function parseChecklistScreenshots(
  imageDataUrls: string[],
  apiKey: string,
): Promise<ParseResult> {
  if (imageDataUrls.length === 0) {
    throw new Error("at least one image required");
  }
  if (imageDataUrls.length > 8) {
    throw new Error("max 8 screenshots per call");
  }

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: "Extract the checklist from these screenshots. Return ONLY the JSON object as specified.",
    },
    ...imageDataUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI Vision ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Vision returned empty");
  const parsed = JSON.parse(content) as Partial<ParseResult>;
  return {
    kind: parsed.kind === "listing" ? "listing" : "transaction",
    slots: Array.isArray(parsed.slots)
      ? parsed.slots
          .filter(
            (s) =>
              s &&
              typeof s.number === "number" &&
              typeof s.label === "string" &&
              s.label.length > 0,
          )
          .map((s) => ({
            number: s.number,
            label: s.label.slice(0, 200),
            required: s.required === "required" ? "required" : "if_applicable",
            tag:
              s.tag === "cda" ||
              s.tag === "closing_docs" ||
              s.tag === "termination"
                ? s.tag
                : null,
          }))
      : [],
  };
}
