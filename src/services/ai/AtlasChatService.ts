/**
 * AtlasChatService
 *
 * Two-way Atlas chat over Telegram. Backed by OpenAI gpt-4.1-mini —
 * uses the existing OPENAI_API_KEY (no new account), and at single-
 * user volume costs ~5¢/month.
 *
 * Receives raw user text, builds a tight context snapshot of the
 * acting account's open deals + recent activity, asks the model
 * for a short reply.
 */

import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  openAiToolSpecs,
  executeTool,
  toolTier,
  previewAction,
  type AtlasActor,
} from "./AtlasTools";
import { toDateInputValue } from "@/lib/dates";

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini";

/** How much extracted text from one attached document we feed the model. */
const DOC_ATTACH_CHARS = 12_000;

/**
 * A file the user dropped into the chat for THIS turn. Deliberately transient:
 * REOS reads it to answer and never stores the bytes (saving a file to a deal
 * is a separate, explicit action through the document library).
 *   - image    → data: URL, read by the vision model (screenshots, photos)
 *   - document → text already extracted server-side (PDF/DOCX)
 */
export interface AtlasAttachment {
  kind: "image" | "document";
  fileName: string;
  /** images only — data:image/...;base64,... */
  dataUrl?: string;
  /** documents only — extracted text */
  text?: string;
}

/** What the browser posts: the file inline as a data URL. */
export interface RawAtlasAttachment {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

/** Total inline attachment budget per turn (base64 inflates ~33%). */
const MAX_ATTACH_BYTES = 12 * 1024 * 1024;

/**
 * Turn browser-posted files into model-ready attachments: images pass straight
 * to the vision model, documents get their text extracted server-side. Nothing
 * is written to the database — this is read-and-discard for one turn.
 */
export async function prepareAtlasAttachments(
  raw: RawAtlasAttachment[],
): Promise<{ attachments: AtlasAttachment[]; skipped: string[] }> {
  const attachments: AtlasAttachment[] = [];
  const skipped: string[] = [];
  let budget = MAX_ATTACH_BYTES;

  for (const f of raw.slice(0, 6)) {
    const b64 = f.dataUrl.split(",")[1] ?? "";
    const approxBytes = Math.floor((b64.length * 3) / 4);
    if (approxBytes <= 0 || approxBytes > budget) {
      skipped.push(f.fileName);
      continue;
    }
    budget -= approxBytes;

    if (f.mimeType.startsWith("image/")) {
      attachments.push({ kind: "image", fileName: f.fileName, dataUrl: f.dataUrl });
      continue;
    }
    // Documents: extract text now, discard the bytes.
    try {
      const { DocumentExtractionService } = await import(
        "@/services/ai/DocumentExtractionService"
      );
      const text = await new DocumentExtractionService().extractText(
        Buffer.from(b64, "base64"),
      );
      if (text?.trim()) {
        attachments.push({ kind: "document", fileName: f.fileName, text });
      } else {
        skipped.push(f.fileName);
      }
    } catch {
      skipped.push(f.fileName);
    }
  }
  return { attachments, skipped };
}

/** The REOS help knowledge base, so Atlas can answer how-to questions too.
 *  Cached per process; same source the /help assistant uses. */
let cachedHelp: string | null = null;
function loadHelpKnowledge(): string {
  if (cachedHelp !== null) return cachedHelp;
  try {
    cachedHelp = fs.readFileSync(path.resolve(process.cwd(), "docs/HELP_KNOWLEDGE.md"), "utf8").slice(0, 14000);
  } catch {
    cachedHelp = "(help knowledge base not bundled)";
  }
  return cachedHelp;
}

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
- Telegram Markdown: *bold*, _italic_, \`mono\`. Use sparingly. Plain text is fine.
- HOW-TO / product questions ("how does the pipeline work?", "how do I invite a
  teammate?", "how do Telegram replies get onto a deal?") — answer from the HELP
  KNOWLEDGE block. If it's not covered there, say so; don't invent features.

ACTIONS — you can DO things, not just answer:
- Tools: find_deal (look up), add_task, complete_task, set_deadline, advance_stage,
  set_stage, add_note.
- CRITICAL: whenever the user asks about, or wants to change, a SPECIFIC deal, you
  MUST call the find_deal tool FIRST with their wording (e.g. "3453 Willard") to
  resolve it — even if you think you see it in CONTEXT, and ESPECIALLY before
  concluding a deal doesn't exist. NEVER say "no deal found" unless find_deal itself
  returned not_found. The CONTEXT list is a hint, not the source of truth — the tools are.
- After find_deal succeeds, call the write tool, passing the SAME deal string.
- WRITE tools (add/complete task, set deadline, advance/set stage, add note) are NOT
  executed until the user confirms — when you call one it's held; reply telling the
  user exactly what you'll do and that you need a "yes". Don't claim it's done.
- If the user is vague and several deals could match, ASK — never guess.
- Only state facts you got from a tool result or CONTEXT. Never invent.`;

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
    todayIso: toDateInputValue(now),
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
      contractDate: toDateInputValue(t.contractDate) || null,
      closingDate: toDateInputValue(t.closingDate) || null,
      daysToClose: t.closingDate ? dayDiff(t.closingDate, now) : null,
      riskScore: t.riskScore,
      lender: t.lenderName,
      titleCompany: t.titleCompanyName,
      salePrice: t.financials?.salePrice ?? null,
      grossCommission: t.financials?.grossCommission ?? null,
      milestones: t.milestones.map((m): MilestoneLite => ({
        type: m.type,
        label: m.label,
        due: toDateInputValue(m.dueAt) || null,
        done: toDateInputValue(m.completedAt) || null,
        overdue:
          !m.completedAt &&
          m.status === "pending" &&
          m.dueAt != null &&
          m.dueAt <= now,
      })),
      openTasks: t.tasks.map((tk) => ({
        title: tk.title,
        due: toDateInputValue(tk.dueAt) || null,
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
      closingDate: toDateInputValue(t.closingDate),
      salePrice: t.financials?.salePrice ?? null,
      grossCommission: t.financials?.grossCommission ?? null,
    })),
  };
}

export interface ProposedAction {
  tool: string;
  args: Record<string, unknown>;
  preview: string;
}
export interface AtlasReply {
  text: string;
  /** Write actions the model wants to take — held until the user
   *  confirms. Empty when the turn was read-only / informational. */
  proposedActions: ProposedAction[];
}

interface ToolCall {
  id: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Agentic Atlas turn. Runs a bounded tool-calling loop: READ tools
 * execute immediately and feed back; WRITE tools are collected as
 * proposed actions and NOT executed (the caller confirms, then runs
 * them via executeTool / the execute endpoint). Returns the reply text
 * plus any pending actions.
 */
export async function askAtlas(
  db: PrismaClient,
  actor: AtlasActor,
  userText: string,
  attachments: AtlasAttachment[] = [],
): Promise<AtlasReply> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const ctx = await buildContext(db, actor.accountId);
  const tools = openAiToolSpecs();

  // Attachments are TRANSIENT — read for this turn, never persisted. Documents
  // arrive as already-extracted text; screenshots as data: URLs for vision.
  const docText = attachments
    .filter((a) => a.kind === "document" && a.text?.trim())
    .map((a) => `--- Attached file: ${a.fileName} ---\n${a.text!.slice(0, DOC_ATTACH_CHARS)}`)
    .join("\n\n");
  const images = attachments.filter((a) => a.kind === "image" && a.dataUrl);

  const textPart = [userText.slice(0, 4000), docText].filter(Boolean).join("\n\n");
  const userContent: unknown =
    images.length > 0
      ? [
          { type: "text", text: textPart },
          ...images.map((a) => ({ type: "image_url", image_url: { url: a.dataUrl } })),
        ]
      : textPart;

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM },
    {
      role: "system",
      content: `CONTEXT (account: ${ctx.account.businessName}):\n${JSON.stringify(ctx)}`,
    },
    { role: "system", content: `HELP KNOWLEDGE (for how-to questions):\n${loadHelpKnowledge()}` },
    { role: "user", content: userContent },
  ];

  const proposedActions: ProposedAction[] = [];
  let finalText = "";

  for (let round = 0; round < 4; round++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages,
        tools,
        tool_choice: "auto",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
    };
    const m = data.choices?.[0]?.message;
    if (!m) break;

    const calls = m.tool_calls ?? [];
    if (process.env.ATLAS_DEBUG) {
      console.error(`[atlas round ${round}] calls=${calls.map((c) => c.function?.name).join(",") || "(none)"} content=${(m.content ?? "").slice(0, 80)}`);
    }
    if (calls.length === 0) {
      finalText = (m.content ?? "").trim();
      break;
    }

    // Keep the assistant message (with tool_calls) in history.
    messages.push(m as unknown as Record<string, unknown>);
    for (const tc of calls) {
      const name = tc.function?.name ?? "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        /* leave args empty → executeTool will reject */
      }
      if (toolTier(name) === "read") {
        const result = await executeTool(db, actor, name, args);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.ok ? result.summary : `Error: ${result.error}`,
        });
      } else {
        proposedActions.push({ tool: name, args, preview: previewAction(name, args) });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "PENDING_CONFIRMATION — not executed yet; it will run only after the user confirms.",
        });
      }
    }
  }

  if (!finalText) {
    finalText = proposedActions.length
      ? "Here's what I'll do — confirm to proceed."
      : "(no reply)";
  }
  return { text: finalText, proposedActions };
}
