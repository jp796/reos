/**
 * SignatureScanService
 *
 * Answers one question per document: are the signature blocks
 * actually signed? Renders the LAST pages of the PDF (signatures
 * live at the end of real-estate contracts) and asks GPT-4o vision
 * to inspect every signature line.
 *
 * Detects all three signing styles:
 *   - wet ink (handwriting in the signature box)
 *   - e-sign stamps (DocuSign / Dotloop / Documenso blocks with
 *     id strings and timestamps)
 *   - adopted typed signatures (cursive-font typed names)
 *
 * status vocabulary (stored on Document.signatureScanStatus):
 *   signed               — every signature line is executed
 *   partial              — some lines signed, some blank
 *   unsigned             — signature lines exist, none signed
 *   no_signature_blocks  — document has no signature lines at all
 *                          (e.g. an inspection report or invoice)
 *
 * Cost: ~$0.01-0.03 per scan (4 pages of gpt-4o vision at 150dpi).
 */

import { renderPdfLastPages } from "./PdfRender";

const VISION_MODEL = "gpt-4o";
const SCAN_PAGES = 4;

export type SignatureScanStatus =
  | "signed"
  | "partial"
  | "unsigned"
  | "no_signature_blocks";

export interface SignatureScanResult {
  status: SignatureScanStatus;
  signedCount: number;
  blankCount: number;
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a real-estate compliance reviewer checking whether a contract document is fully executed.

You will see the LAST pages of a PDF — where signature blocks live.

For every signature line / signature box you can see, decide whether it is SIGNED or BLANK. A line counts as SIGNED if it has any of:
- handwriting (wet ink signature or initials)
- an e-signature stamp (DocuSign / dotloop / Documenso style block with a name, ID string, or timestamp)
- a typed adopted signature (name rendered in a cursive/script font inside the signature area)

A line counts as BLANK if the signature area is empty, shows only the printed label ("Seller's Signature", "Date"), or contains only an X placeholder.

Ignore: dates, printed names, addresses, checkbox initials inside paragraphs (count separate INITIAL lines if clearly present as required initial blocks).

Respond ONLY with JSON:
{
  "signedCount": <int>,
  "blankCount": <int>,
  "status": "signed" | "partial" | "unsigned" | "no_signature_blocks",
  "notes": "<one short sentence, e.g. 'Buyer signed, seller line blank on page 9'>"
}

status rules:
- no signature lines visible at all -> "no_signature_blocks"
- blankCount == 0 and signedCount > 0 -> "signed"
- signedCount > 0 and blankCount > 0 -> "partial"
- signedCount == 0 and blankCount > 0 -> "unsigned"`;

export async function scanSignatures(
  buffer: Buffer,
  openaiApiKey: string,
): Promise<SignatureScanResult> {
  const pngs = await renderPdfLastPages(buffer, SCAN_PAGES);
  if (pngs.length === 0) {
    throw new Error("signature scan: pdf rendered 0 pages");
  }

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
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `These are the last ${pngs.length} page(s) of the document. Inspect every signature line.`,
            },
            ...imageContent,
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `OpenAI signature scan ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("signature scan: empty response");

  const parsed = JSON.parse(raw) as Partial<SignatureScanResult>;
  const signedCount = typeof parsed.signedCount === "number" ? parsed.signedCount : 0;
  const blankCount = typeof parsed.blankCount === "number" ? parsed.blankCount : 0;
  let status: SignatureScanStatus;
  if (
    parsed.status === "signed" ||
    parsed.status === "partial" ||
    parsed.status === "unsigned" ||
    parsed.status === "no_signature_blocks"
  ) {
    status = parsed.status;
  } else {
    // Derive from counts when the model returned a stray status.
    if (signedCount === 0 && blankCount === 0) status = "no_signature_blocks";
    else if (blankCount === 0) status = "signed";
    else if (signedCount === 0) status = "unsigned";
    else status = "partial";
  }
  return {
    status,
    signedCount,
    blankCount,
    notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : null,
  };
}
