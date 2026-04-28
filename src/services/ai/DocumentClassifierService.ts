/**
 * DocumentClassifierService
 *
 * Classifies a Document against the Rezen slot list using a small
 * LLM call. Reads first ~4000 chars of extractedText, presents the
 * candidate slot labels, asks the model to pick one or none.
 *
 * Cheap: gpt-4o-mini, <500 input tokens, <30 output tokens. Designed
 * to run over hundreds of historical Documents in a single batch
 * request without breaking the bank.
 *
 * Output is stored on Document.suggestedRezenSlot + confidence.
 * RezenCompliancePrep prefers this signal over filename keywords.
 */

import {
  TRANSACTION_SLOTS,
  LISTING_SLOTS,
} from "@/services/core/RezenCompliancePrep";

const MODEL = process.env.OPENAI_CLASSIFIER_MODEL || "gpt-4o-mini";

export interface ClassificationResult {
  /** Slot key from TRANSACTION_SLOTS or LISTING_SLOTS, or null. */
  slotKey: string | null;
  /** 0..1; below 0.5 means the model wasn't sure. */
  confidence: number;
  /** Short reason — kept on AutomationAuditLog for explainability. */
  reason: string;
}

/** Build the slot menu the LLM picks from. Dedupe by key so a
 * "Lead-Based Paint Disclosure" that appears in both checklists
 * shows up once. */
function buildSlotMenu(): Array<{ key: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string }> = [];
  for (const slot of [...TRANSACTION_SLOTS, ...LISTING_SLOTS]) {
    if (seen.has(slot.key)) continue;
    seen.add(slot.key);
    out.push({ key: slot.key, label: slot.label });
  }
  return out;
}

const SLOT_MENU = buildSlotMenu();

const SYSTEM_PROMPT = `You classify real-estate transaction documents against a brokerage compliance checklist.

You will be given:
1. A document's filename + first ~3500 chars of its text.
2. A menu of valid slot keys with their labels.

Output a JSON object: {"slotKey": "<key>" | null, "confidence": 0.0..1.0, "reason": "<short>"}.

Pick exactly one slotKey from the menu when the document clearly fills that slot. Return null when:
- the document is junk (advertising, signature blocks only, etc.)
- the document fits multiple slots equally
- you'd be guessing

Be strict. False positives are worse than missed classifications because they silently put the wrong file in Rezen.`;

export async function classifyDocument(args: {
  filename: string;
  extractedText: string | null;
  openaiApiKey: string;
}): Promise<ClassificationResult> {
  const text = (args.extractedText ?? "").slice(0, 3500);
  if (!text || text.length < 50) {
    return { slotKey: null, confidence: 0, reason: "no extractable text" };
  }

  const userPrompt = [
    `Filename: ${args.filename}`,
    "",
    "Document text (truncated):",
    text,
    "",
    "Slot menu:",
    SLOT_MENU.map((s) => `- ${s.key}: ${s.label}`).join("\n"),
    "",
    'Respond ONLY with JSON: {"slotKey": "...", "confidence": 0.0..1.0, "reason": "..."}',
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.0,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return { slotKey: null, confidence: 0, reason: "model returned empty" };
  }

  let parsed: Partial<ClassificationResult> & { slotKey?: string | null };
  try {
    parsed = JSON.parse(content) as Partial<ClassificationResult>;
  } catch {
    return { slotKey: null, confidence: 0, reason: "json parse failed" };
  }

  // Validate the returned key is in our menu.
  const validKey =
    parsed.slotKey && SLOT_MENU.some((s) => s.key === parsed.slotKey)
      ? parsed.slotKey
      : null;

  return {
    slotKey: validKey,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
  };
}
