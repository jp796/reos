/**
 * AtlasChatService
 *
 * Two-way Atlas chat over Telegram. Backed by OpenAI gpt-4o-mini —
 * uses the existing OPENAI_API_KEY (no new account), and at single-
 * user volume costs ~5¢/month.
 *
 * Receives raw user text, builds a tight context snapshot of the
 * acting account's open deals + recent activity, asks the model
 * for a short reply.
 */

import type { PrismaClient } from "@prisma/client";

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

const SYSTEM = `You are Atlas, the user's real-estate transaction chief of staff inside REOS.
You're being asked questions over Telegram by the user (an agent or coordinator).

You receive a CONTEXT block with the user's open deals (each with milestones, tasks,
documents, participants, lender/title, financials, risk score) plus the last 20 closings.

Reply rules:
- BE BRIEF. Phone-screen friendly. Bullet lists work.
- Use the property address as the deal's anchor (matched flexibly — "509 Bent" matches
  "509 Bent Avenue in Cheyenne, WY").
- Filter by what the user asked: closing this week → openDeals where daysToClose 0-7.
  Overdue → milestones[].overdue==true. Missing X doc → search documents[].rezenSlot
  and fileName.
- Match contact names loosely (case-insensitive, partial first/last).
- If the answer needs data NOT in the CONTEXT (e.g. financial detail not loaded),
  give what you DO have first, then note the limitation. Don't say "no data" without
  trying.
- No pleasantries. No "I hope this helps". No "let me know if".
- Telegram Markdown: *bold*, _italic_, \`mono\`. Use sparingly. Plain text is fine.`;

interface MilestoneLite {
  type: string;
  label: string;
  due: string | null;
  done: string | null;
  overdue: boolean;
}
interface DocLite {
  fileName: string;
  category: string | null;
  rezenSlot: string | null;
  source: string;
}
interface DealLite {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  contact: string;
  contactEmail: string | null;
  contactPhone: string | null;
  side: string | null;
  status: string;
  contractDate: string | null;
  closingDate: string | null;
  daysToClose: number | null;
  riskScore: number;
  lender: string | null;
  titleCompany: string | null;
  salePrice: number | null;
  grossCommission: number | null;
  milestones: MilestoneLite[];
  openTasks: Array<{ title: string; due: string | null; priority: string }>;
  documents: DocLite[];
  participants: Array<{ name: string; role: string; email: string | null }>;
}
interface ChatContextBlob {
  account: { id: string; businessName: string };
  todayIso: string;
  openDeals: DealLite[];
  recentClosings: Array<{
    address: string;
    contact: string;
    closingDate: string;
    salePrice: number | null;
    grossCommission: number | null;
  }>;
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
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
      contact: {
        select: {
          fullName: true,
          primaryEmail: true,
          primaryPhone: true,
        },
      },
      financials: {
        select: { salePrice: true, grossCommission: true },
      },
      milestones: {
        select: {
          type: true,
          status: true,
          completedAt: true,
          dueAt: true,
          label: true,
        },
        orderBy: { dueAt: "asc" },
      },
      tasks: {
        where: { completedAt: null },
        select: { title: true, dueAt: true, priority: true },
        orderBy: { dueAt: "asc" },
        take: 5,
      },
      documents: {
        select: {
          fileName: true,
          category: true,
          source: true,
          suggestedRezenSlot: true,
        },
        orderBy: { uploadedAt: "desc" },
        take: 12,
      },
      participants: {
        select: {
          role: true,
          contact: { select: { fullName: true, primaryEmail: true } },
        },
      },
    },
    take: 60,
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
      financials: { select: { salePrice: true, grossCommission: true } },
    },
    orderBy: { closingDate: "desc" },
    take: 20,
  });

  return {
    account: {
      id: account?.id ?? accountId,
      businessName: account?.businessName ?? "REOS",
    },
    todayIso: now.toISOString().slice(0, 10),
    openDeals: open.map((t): DealLite => ({
      id: t.id,
      address: t.propertyAddress ?? "(no address)",
      city: t.city,
      state: t.state,
      contact: t.contact.fullName,
      contactEmail: t.contact.primaryEmail,
      contactPhone: t.contact.primaryPhone,
      side: t.side,
      status: t.status,
      contractDate: t.contractDate?.toISOString().slice(0, 10) ?? null,
      closingDate: t.closingDate?.toISOString().slice(0, 10) ?? null,
      daysToClose: t.closingDate ? dayDiff(t.closingDate, now) : null,
      riskScore: t.riskScore,
      lender: t.lenderName,
      titleCompany: t.titleCompanyName,
      salePrice: t.financials?.salePrice ?? null,
      grossCommission: t.financials?.grossCommission ?? null,
      milestones: t.milestones.map((m): MilestoneLite => ({
        type: m.type,
        label: m.label,
        due: m.dueAt?.toISOString().slice(0, 10) ?? null,
        done: m.completedAt?.toISOString().slice(0, 10) ?? null,
        overdue:
          !m.completedAt &&
          m.status === "pending" &&
          m.dueAt != null &&
          m.dueAt <= now,
      })),
      openTasks: t.tasks.map((tk) => ({
        title: tk.title,
        due: tk.dueAt?.toISOString().slice(0, 10) ?? null,
        priority: tk.priority,
      })),
      documents: t.documents.map((d): DocLite => ({
        fileName: d.fileName,
        category: d.category,
        rezenSlot: d.suggestedRezenSlot,
        source: d.source,
      })),
      participants: t.participants.map((p) => ({
        name: p.contact.fullName,
        role: p.role,
        email: p.contact.primaryEmail,
      })),
    })),
    recentClosings: closings.map((t) => ({
      address: t.propertyAddress ?? t.contact.fullName,
      contact: t.contact.fullName,
      closingDate: t.closingDate?.toISOString().slice(0, 10) ?? "",
      salePrice: t.financials?.salePrice ?? null,
      grossCommission: t.financials?.grossCommission ?? null,
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
