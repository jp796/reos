/**
 * AtlasChatService
 *
 * Two-way Atlas chat over Telegram (and any future inbound channel).
 * Uses OpenAI gpt-4o-mini — cheapest path that still reads context
 * well and you already have the key. ~$0.0001 / message at typical
 * chat volume.
 *
 * Receives raw user text, builds a tight context snapshot of the
 * acting account's open deals + recent activity, asks the model for
 * a short reply.
 */

import type { PrismaClient } from "@prisma/client";

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

const SYSTEM = `You are Atlas, the user's real-estate transaction chief of staff inside REOS.
You're being asked questions over Telegram by the user (an agent or coordinator).

Reply rules:
- Be brief. Phone-screen friendly. Bullet points when useful.
- Numbers tabular when relevant.
- If the user asks about a specific deal, use the property address as the anchor.
- If you don't have the data needed to answer, say so plainly — don't invent.
- No pleasantries, no "I hope this helps", no "let me know if". Just the answer.
- Telegram supports basic Markdown: *bold*, _italic_, \`mono\`. Use sparingly.

You'll receive a CONTEXT block with a snapshot of every open deal plus recent activity.
Use only that data for facts. If the user asks something not in the context, say so.`;

interface ChatContextBlob {
  account: { id: string; businessName: string };
  openDeals: Array<{
    id: string;
    address: string;
    contact: string;
    side: string | null;
    status: string;
    contractDate: string | null;
    closingDate: string | null;
    riskScore: number;
    overdueMilestones: number;
    pendingMilestones: number;
  }>;
  recentClosings: Array<{
    address: string;
    closingDate: string;
    salePrice: number | null;
  }>;
}

async function buildContext(
  db: PrismaClient,
  accountId: string,
): Promise<ChatContextBlob> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { id: true, businessName: true },
  });
  const now = new Date();
  const open = await db.transaction.findMany({
    where: { accountId, status: { notIn: ["closed", "dead"] } },
    include: {
      contact: { select: { fullName: true } },
      milestones: {
        select: {
          status: true,
          completedAt: true,
          dueAt: true,
          label: true,
        },
      },
    },
    take: 50,
    orderBy: { closingDate: "asc" },
  });
  const closings = await db.transaction.findMany({
    where: {
      accountId,
      status: "closed",
      excludeFromProduction: false,
    },
    include: {
      contact: { select: { fullName: true } },
      financials: { select: { salePrice: true } },
    },
    orderBy: { closingDate: "desc" },
    take: 5,
  });
  return {
    account: {
      id: account?.id ?? accountId,
      businessName: account?.businessName ?? "REOS",
    },
    openDeals: open.map((t) => {
      const overdue = t.milestones.filter(
        (m) =>
          !m.completedAt &&
          m.status === "pending" &&
          m.dueAt != null &&
          m.dueAt <= now,
      ).length;
      const pending = t.milestones.filter((m) => !m.completedAt).length;
      return {
        id: t.id,
        address: t.propertyAddress ?? "(no address)",
        contact: t.contact.fullName,
        side: t.side,
        status: t.status,
        contractDate: t.contractDate?.toISOString().slice(0, 10) ?? null,
        closingDate: t.closingDate?.toISOString().slice(0, 10) ?? null,
        riskScore: t.riskScore,
        overdueMilestones: overdue,
        pendingMilestones: pending,
      };
    }),
    recentClosings: closings.map((t) => ({
      address: t.propertyAddress ?? t.contact.fullName,
      closingDate: t.closingDate?.toISOString().slice(0, 10) ?? "",
      salePrice: t.financials?.salePrice ?? null,
    })),
  };
}

export interface AtlasReply {
  text: string;
}

export async function askAtlas(
  db: PrismaClient,
  accountId: string,
  userText: string,
): Promise<AtlasReply> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const ctx = await buildContext(db, accountId);

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
        { role: "system", content: SYSTEM },
        {
          role: "system",
          content: `CONTEXT (account: ${ctx.account.businessName}):\n${JSON.stringify(ctx, null, 2)}`,
        },
        { role: "user", content: userText.slice(0, 2000) },
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
  const text = data.choices?.[0]?.message?.content?.trim();
  return { text: text || "(empty reply)" };
}
