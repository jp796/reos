/**
 * TransactionSummaryService
 *
 * Produces a short AI-generated summary of a transaction's recent Gmail
 * communication + milestones + risk factors using OpenAI.
 * Cached on Transaction.aiSummary (updated at aiSummaryUpdatedAt) so
 * repeat page loads are instant.
 */

import type { PrismaClient } from "@prisma/client";
import type { gmail_v1 } from "googleapis";
import type { GmailService } from "@/services/integrations/GmailService";
import { RiskScoringService } from "@/services/core/RiskScoringService";

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini";

export interface SummarizeInput {
  transactionId: string;
}

export interface SummarizeResult {
  summary: string;
  threadsSummarized: number;
  milestonesConsidered: number;
  model: string;
}

export class TransactionSummaryService {
  constructor(
    private readonly db: PrismaClient,
    private readonly gmail: GmailService | null, // may be null when Gmail isn't connected
    private readonly openaiApiKey: string,
  ) {}

  async summarize(transactionId: string): Promise<SummarizeResult> {
    const txn = await this.db.transaction.findUnique({
      where: { id: transactionId },
      include: {
        contact: true,
        milestones: { orderBy: { dueAt: "asc" } },
        tasks: true,
        communicationEvents: {
          orderBy: { happenedAt: "desc" },
          take: 10,
        },
      },
    });
    if (!txn) throw new Error("transaction not found");

    // 1. Pull recent Gmail threads tied to this transaction via
    //    stored communicationEvents + fresh searches by address/contact.
    const threadSummaries: string[] = [];
    if (this.gmail && txn.contact) {
      const query = buildThreadQuery(txn);
      if (query) {
        try {
          const { threads } = await this.gmail.searchThreads({
            q: query,
            maxResults: 10,
          });
          for (const t of threads) {
            const s = summarizeThreadLocally(t);
            if (s) threadSummaries.push(s);
          }
        } catch (err) {
          console.warn("Thread search for summary failed:", err);
        }
      }
    }

    // 2. Risk factors (already deterministic)
    const risk = new RiskScoringService().compute({ transaction: txn });

    // 3. Build the prompt
    const prompt = buildPrompt(txn, threadSummaries, risk);

    // 4. OpenAI call
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You are Atlas, a real-estate-transaction chief of staff. Given facts about a deal, write a tight, useful 3-5 sentence status summary. Prioritize: where the deal stands today, upcoming or overdue items, risk signals, and the single most important next action. No pleasantries. No markdown headings — plain prose.",
          },
          { role: "user", content: prompt },
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
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new Error("OpenAI returned empty summary");

    // 5. Cache
    await this.db.transaction.update({
      where: { id: transactionId },
      data: {
        aiSummary: summary,
        aiSummaryUpdatedAt: new Date(),
      },
    });

    return {
      summary,
      threadsSummarized: threadSummaries.length,
      milestonesConsidered: txn.milestones.length,
      model: MODEL,
    };
  }
}

// ==================================================
// Prompt assembly
// ==================================================

function buildThreadQuery(
  txn: { propertyAddress: string | null; contact: { fullName: string; primaryEmail: string | null } },
): string | null {
  const parts: string[] = [];
  if (txn.contact.primaryEmail) parts.push(`from:${txn.contact.primaryEmail}`);
  if (txn.contact.primaryEmail) parts.push(`to:${txn.contact.primaryEmail}`);
  if (txn.propertyAddress) {
    // Extract just the street number + street name for a looser match
    const first = txn.propertyAddress.split(",")[0].trim();
    parts.push(`"${first}"`);
  }
  if (parts.length === 0) return null;
  return `(${parts.join(" OR ")}) newer_than:180d`;
}

function summarizeThreadLocally(thread: gmail_v1.Schema$Thread): string | null {
  const msg = thread.messages?.[thread.messages.length - 1];
  if (!msg) return null;
  const hs = msg.payload?.headers ?? [];
  const subject =
    hs.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
  const from = hs.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
  const date = msg.internalDate
    ? new Date(parseInt(msg.internalDate, 10)).toISOString().slice(0, 10)
    : "";
  const snippet = msg.snippet ?? "";
  return `- [${date}] From: ${from.slice(0, 60)} | Subject: ${subject.slice(0, 80)} | ${snippet.slice(0, 160)}`;
}

function buildPrompt(
  txn: {
    id: string;
    status: string;
    transactionType: string;
    side: string | null;
    propertyAddress: string | null;
    contact: { fullName: string };
    contractDate: Date | null;
    closingDate: Date | null;
    milestones: Array<{
      label: string;
      dueAt: Date | null;
      completedAt: Date | null;
      status: string;
    }>;
    tasks: Array<{
      title: string;
      dueAt: Date | null;
      completedAt: Date | null;
    }>;
    communicationEvents: Array<{
      type: string;
      source: string;
      subject: string | null;
      summary: string | null;
      happenedAt: Date;
    }>;
  },
  gmailSnippets: string[],
  risk: { score: number; factors: Array<{ description: string }> },
): string {
  const fmt = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : "—";
  const ms = txn.milestones
    .slice(0, 10)
    .map(
      (m) =>
        `- ${m.label} (due ${m.dueAt ? fmt(m.dueAt) : "no date yet"}) ${m.completedAt ? "✓ done" : m.status}`,
    )
    .join("\n");
  const ts = txn.tasks
    .slice(0, 8)
    .map(
      (t) =>
        `- ${t.title} (due ${fmt(t.dueAt)}) ${t.completedAt ? "✓ done" : "pending"}`,
    )
    .join("\n");
  const comms = txn.communicationEvents
    .slice(0, 10)
    .map(
      (c) =>
        `- [${fmt(c.happenedAt)}] ${c.type}/${c.source}: ${c.subject ?? ""} — ${(c.summary ?? "").slice(0, 120)}`,
    )
    .join("\n");
  const riskList = risk.factors
    .map((f) => `- ${f.description}`)
    .join("\n");

  return [
    `Client: ${txn.contact.fullName}`,
    `Property: ${txn.propertyAddress ?? "(none)"}`,
    `Type: ${txn.transactionType}${txn.side ? ` (${txn.side})` : ""}`,
    `Status: ${txn.status}`,
    `Contract: ${fmt(txn.contractDate)}  Closing: ${fmt(txn.closingDate)}`,
    "",
    `Risk score: ${risk.score}/100`,
    riskList || "(no risk factors)",
    "",
    "Milestones:",
    ms || "(none)",
    "",
    "Tasks:",
    ts || "(none)",
    "",
    "Recent communications (local log):",
    comms || "(none)",
    "",
    "Recent Gmail threads (live):",
    gmailSnippets.join("\n") || "(none)",
    "",
    "Write the status summary now.",
  ].join("\n");
}
