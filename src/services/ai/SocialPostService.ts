/**
 * SocialPostService
 *
 * Generates ready-to-post social captions for a transaction event.
 * Three platforms covered per call (Instagram, Facebook, LinkedIn)
 * with platform-appropriate tone, length, and hashtag conventions.
 *
 * Uses OpenAI gpt-4o-mini (existing key, ~$0.0005 per generation).
 * No image generation in v1 — user supplies the property photo;
 * REOS supplies the words.
 */

import type { PrismaClient } from "@prisma/client";

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

export type SocialEvent = "new_listing" | "under_contract" | "sold";

export interface SocialPostBundle {
  event: SocialEvent;
  instagram: string;
  facebook: string;
  linkedin: string;
  hashtags: string[];
}

const EVENT_LABEL: Record<SocialEvent, string> = {
  new_listing: "Just Listed",
  under_contract: "Under Contract",
  sold: "Just Sold",
};

const SYSTEM = `You write social media posts for real-estate agents announcing transactions.

You'll receive:
- Event type (Just Listed | Under Contract | Just Sold)
- Property details (address, city, state)
- Sale price (or list price for new listings)
- Agent name + brokerage
- Side (buy / sell / dual)

Output JSON: {"instagram": "...", "facebook": "...", "linkedin": "...", "hashtags": ["..", "..."]}.

Rules per platform:
- Instagram: 3-5 short lines, emojis OK, end with a soft CTA. Under 200 chars.
- Facebook: warmer + longer (3-5 sentences). Personal voice. Under 600 chars. No emoji spam.
- LinkedIn: professional, market-perspective angle. 4-6 sentences. Mention market dynamics. Under 800 chars. No emojis.
- Hashtags: 8-12 mixing brand-name (#RealBrokerLLC), city (#CheyenneRealEstate), event (#JustSold), generic (#RealEstate). Lowercase city, no special chars.

Tone: confident, grateful when applicable, never desperate. Match the agent voice.
Mention the property location naturally — never spam the address. If the side is "sell" mention listing/representing the seller; "buy" mention helping the buyer; "both" gracefully say "had the privilege of representing both sides".`;

export async function generateSocialPosts(
  db: PrismaClient,
  transactionId: string,
  event: SocialEvent,
): Promise<SocialPostBundle> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const txn = await db.transaction.findUnique({
    where: { id: transactionId },
    include: {
      contact: true,
      financials: true,
      account: { select: { businessName: true, settingsJson: true } },
    },
  });
  if (!txn) throw new Error("transaction not found");

  const settings = (txn.account.settingsJson ?? {}) as Record<string, unknown>;
  const broker = (settings.broker ?? {}) as Record<string, string>;
  const agentName = broker.agentName ?? txn.account.businessName;
  const brokerageName = broker.brokerageName ?? txn.account.businessName;

  const price =
    event === "new_listing"
      ? (txn.listPrice ?? txn.financials?.salePrice ?? null)
      : (txn.financials?.salePrice ?? null);

  const userPrompt = JSON.stringify({
    event: EVENT_LABEL[event],
    propertyAddress: txn.propertyAddress ?? "(no address)",
    city: txn.city,
    state: txn.state,
    price,
    side: txn.side,
    transactionType: txn.transactionType,
    agentName,
    brokerageName,
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
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
  if (!content) throw new Error("empty response from OpenAI");
  const parsed = JSON.parse(content) as Partial<SocialPostBundle>;
  return {
    event,
    instagram: parsed.instagram ?? "",
    facebook: parsed.facebook ?? "",
    linkedin: parsed.linkedin ?? "",
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
  };
}
