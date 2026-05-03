/**
 * VoiceIntakeService
 *
 * Audio → text (OpenAI Whisper) → structured deal extraction (GPT-
 * 4o-mini, JSON-mode) → draft Transaction. Used by the voice-note
 * intake page so an agent can dictate "Got a contract on 509 Bent
 * Avenue, sale price 450k, closing June 15, buyers John and Paula
 * Hamilton at jp@example.com" and REOS scaffolds the deal.
 */

const TRANSCRIBE_MODEL = "whisper-1";
const EXTRACT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

export interface ExtractedDeal {
  side: "buy" | "sell" | "both" | null;
  status: "listing" | "active" | "pending" | "closed" | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  salePrice: number | null;
  listPrice: number | null;
  closingDate: string | null;
  contractDate: string | null;
  buyers: Array<{ name: string; email?: string; phone?: string }>;
  sellers: Array<{ name: string; email?: string; phone?: string }>;
  lender: string | null;
  titleCompany: string | null;
  notes: string | null;
}

const EXTRACTION_PROMPT = `You extract structured real-estate deal data from a transcribed voice note.

Output ONLY a JSON object matching this schema (use null when not mentioned):
{
  "side": "buy" | "sell" | "both" | null,
  "status": "listing" | "active" | "pending" | "closed" | null,
  "propertyAddress": string | null,
  "city": string | null,
  "state": string (2-letter) | null,
  "zip": string | null,
  "salePrice": number | null,
  "listPrice": number | null,
  "closingDate": "YYYY-MM-DD" | null,
  "contractDate": "YYYY-MM-DD" | null,
  "buyers": [{ "name": string, "email"?: string, "phone"?: string }],
  "sellers": [{ "name": string, "email"?: string, "phone"?: string }],
  "lender": string | null,
  "titleCompany": string | null,
  "notes": string | null
}

Rules:
- Be conservative. If a field isn't clearly stated, use null.
- "Got a contract on X" implies status=active. "Just listed X" implies listing.
- Parse natural-language dates ("June 15" → 2026-06-15 if year not given,
  use the next-occurring instance).
- For prices: "four-fifty" or "450k" → 450000.
- Names: split first/last as the agent dictates. If only first names given, that's fine.
- "buyer Jane and seller John" means buyers=[Jane], sellers=[John].`;

/**
 * Whisper transcription. audioBuffer must be a webm / mp3 / wav /
 * mp4 — Whisper's accepted formats. Returns plain text.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  apiKey: string,
  filename = "intake.webm",
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" }),
    filename,
  );
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "en");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Whisper ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

/**
 * Transcript → structured deal fields via GPT JSON-mode.
 */
export async function extractDealFromTranscript(
  transcript: string,
  apiKey: string,
): Promise<ExtractedDeal> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nTranscript:\n${transcript.slice(0, 4000)}`,
        },
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
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI returned empty content");
  const parsed = JSON.parse(content) as Partial<ExtractedDeal>;
  return {
    side: parsed.side ?? null,
    status: parsed.status ?? null,
    propertyAddress: parsed.propertyAddress ?? null,
    city: parsed.city ?? null,
    state: parsed.state ?? null,
    zip: parsed.zip ?? null,
    salePrice: parsed.salePrice ?? null,
    listPrice: parsed.listPrice ?? null,
    closingDate: parsed.closingDate ?? null,
    contractDate: parsed.contractDate ?? null,
    buyers: Array.isArray(parsed.buyers) ? parsed.buyers : [],
    sellers: Array.isArray(parsed.sellers) ? parsed.sellers : [],
    lender: parsed.lender ?? null,
    titleCompany: parsed.titleCompany ?? null,
    notes: parsed.notes ?? null,
  };
}
