/**
 * HelpAssistantService — answers "how do I use REOS?" questions.
 *
 * Reuses the same model + auth path as Atlas chat, but with a
 * help-only system prompt + a static knowledge-base instead of
 * the user's deal context. Cheap (~$0.0001 per Q).
 */

import fs from "node:fs";
import path from "node:path";

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

const SYSTEM_PROMPT = `You are the REOS Help assistant — a how-to guide for the REOS Transaction OS.

Style:
- Brief. Phone-screen friendly.
- Use bullet points for steps.
- Reference exact UI paths (e.g. /transactions, "Settings → Brokerage").
- Quote feature names exactly.
- If you don't know the answer from the knowledge base, say so plainly + suggest contacting support@myrealestateos.com.
- DO NOT invent features that aren't in the knowledge base.

Tone:
- Confident but not robotic.
- Skip "I hope this helps" / "Let me know if".
- Match the user's phrasing.`;

let cachedKnowledge: string | null = null;
function loadKnowledge(): string {
  if (cachedKnowledge) return cachedKnowledge;
  try {
    const p = path.resolve(process.cwd(), "docs/HELP_KNOWLEDGE.md");
    cachedKnowledge = fs.readFileSync(p, "utf8");
  } catch {
    cachedKnowledge = "(help knowledge base not bundled)";
  }
  return cachedKnowledge;
}

export interface HelpReply {
  text: string;
}

export async function askHelpAssistant(question: string): Promise<HelpReply> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const knowledge = loadKnowledge();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "system",
          content: `KNOWLEDGE BASE:\n${knowledge.slice(0, 12000)}`,
        },
        { role: "user", content: question.slice(0, 1000) },
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
  return {
    text: data.choices?.[0]?.message?.content?.trim() ?? "(empty reply)",
  };
}
