/**
 * EmailDraftService
 *
 * Generates an AI-drafted reply to the most recent inbound Gmail
 * thread tied to a transaction. The draft is JSON only — the caller
 * (route handler) is responsible for turning it into a Gmail draft
 * via users.drafts.create.
 *
 * v1 design choices:
 *   - Reply target is the most recent INBOUND message across the
 *     transaction's matched threads. If you want a specific thread,
 *     pass threadId.
 *   - We never autosend. Output is a draft body the human reviews.
 *   - We never invent prices, EM figures, commission, or dates not
 *     present in the source thread + transaction context. The system
 *     prompt forbids it; for anything the AI doesn't know it must
 *     leave a [PLACEHOLDER] tag for the human to fill.
 *   - Tone tuned to TC voice — terse, warm, professional. Short.
 *   - Watermarked: every body ends with a hidden HTML comment so
 *     reviewers can tell at a glance that REOS drafted it. The
 *     comment is stripped by Gmail's compose UI on send (HTML mode)
 *     OR shows up in plain-text drafts (which is fine — the TC sees
 *     it before sending).
 */

import type { PrismaClient } from "@prisma/client";
import type { gmail_v1 } from "googleapis";
import type { GmailService } from "@/services/integrations/GmailService";

const MODEL = process.env.OPENAI_DRAFT_MODEL || "gpt-4o-mini";

/** What the service returns. The route handler turns this into a
 * Gmail draft via users.drafts.create. */
export interface DraftReplyResult {
  subject: string;
  body: string;
  /** Thread we're replying to (Gmail thread.id). */
  threadId: string;
  /** Message-Id header of the message being replied to — used to
   * populate In-Reply-To + References when assembling the RFC822
   * draft so Gmail threads it correctly. */
  replyToMessageId: string;
  /** The inbound message's From — primary "To" for the draft. */
  replyTo: string;
  /** Carbon-copy candidates extracted from the original thread's
   * participants (excludes self). Caller may choose to populate. */
  cc: string[];
  /** Model used — surfaced in logs / UI for observability. */
  model: string;
}

export class EmailDraftService {
  constructor(
    private readonly db: PrismaClient,
    private readonly gmail: GmailService,
    private readonly openaiApiKey: string,
    /** The user's own email address. Used to filter "inbound" (not
     * from self) and to omit self from CC suggestions. */
    private readonly selfEmail: string,
  ) {}

  async draftReply(
    transactionId: string,
    threadIdOpt?: string,
  ): Promise<DraftReplyResult> {
    const txn = await this.db.transaction.findUnique({
      where: { id: transactionId },
      include: {
        contact: true,
        milestones: { orderBy: { dueAt: "asc" }, take: 8 },
        tasks: {
          where: { completedAt: null },
          orderBy: { dueAt: "asc" },
          take: 6,
        },
      },
    });
    if (!txn) throw new Error("transaction not found");

    // 1. Find the reply target — either the thread the caller named
    //    or the most recent inbound thread we can match to this txn.
    const target = await this.findReplyTarget(txn, threadIdOpt);
    if (!target) {
      throw new Error(
        "No recent inbound email found for this transaction. " +
          "Open a thread first or pass a specific threadId.",
      );
    }

    // 2. Build the prompt with transaction context + the inbound msg.
    const prompt = buildDraftPrompt(txn, target);

    // 3. OpenAI call — strict JSON output so we don't have to parse
    //    "Subject: …\n\n…" from prose.
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: { subject?: string; body?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI returned non-JSON; refusing to ship a malformed draft");
    }
    if (!parsed.subject || !parsed.body) {
      throw new Error("AI draft missing subject or body");
    }

    // 4. Watermark — invisible in HTML, visible (but harmless) in
    //    plain text. Either way, a reviewer can find it.
    const watermarked = parsed.body.trimEnd() +
      "\n\n<!-- AI-drafted by REOS — review before sending -->";

    return {
      subject: parsed.subject.trim(),
      body: watermarked,
      threadId: target.threadId,
      replyToMessageId: target.messageIdHeader,
      replyTo: target.fromEmail,
      cc: target.ccCandidates,
      model: MODEL,
    };
  }

  // ----------------------------------------------------------------
  // Reply-target discovery
  // ----------------------------------------------------------------

  /**
   * Find the message we should reply to: the most recent inbound
   * message across threads matched to this transaction. "Inbound"
   * means From != self.
   *
   * If threadIdOpt is provided, scope to that single thread.
   */
  private async findReplyTarget(
    txn: {
      contact: { fullName: string; primaryEmail: string | null };
      propertyAddress: string | null;
    },
    threadIdOpt?: string,
  ): Promise<ReplyTarget | null> {
    let threads: gmail_v1.Schema$Thread[];
    if (threadIdOpt) {
      const t = await this.gmail.getThread(threadIdOpt);
      threads = t ? [t] : [];
    } else {
      const query = buildThreadQuery(txn);
      if (!query) return null;
      const res = await this.gmail.searchThreads({ q: query, maxResults: 10 });
      threads = res.threads;
    }
    // Flatten every message across threads, keep only inbound (From
    // != self), then pick the most recent by internalDate.
    const inbound: Array<{ thread: gmail_v1.Schema$Thread; msg: gmail_v1.Schema$Message; ts: number }> = [];
    for (const t of threads) {
      for (const m of t.messages ?? []) {
        const from = headerValue(m, "from") ?? "";
        const fromAddr = extractEmail(from).toLowerCase();
        if (!fromAddr) continue;
        if (fromAddr === this.selfEmail.toLowerCase()) continue;
        const ts = parseInt(m.internalDate ?? "0", 10);
        inbound.push({ thread: t, msg: m, ts });
      }
    }
    if (inbound.length === 0) return null;
    inbound.sort((a, b) => b.ts - a.ts);
    const pick = inbound[0];

    const from = headerValue(pick.msg, "from") ?? "";
    const messageIdHeader = headerValue(pick.msg, "message-id") ?? "";
    const subject = headerValue(pick.msg, "subject") ?? "";
    const toList = (headerValue(pick.msg, "to") ?? "")
      .split(",")
      .map((s) => extractEmail(s).toLowerCase())
      .filter(Boolean);
    const ccList = (headerValue(pick.msg, "cc") ?? "")
      .split(",")
      .map((s) => extractEmail(s).toLowerCase())
      .filter(Boolean);
    const ccCandidates = [...toList, ...ccList].filter(
      (e) => e !== this.selfEmail.toLowerCase() && e !== extractEmail(from).toLowerCase(),
    );

    return {
      threadId: pick.thread.id ?? "",
      messageIdHeader,
      fromEmail: extractEmail(from),
      fromHeader: from,
      subject,
      bodyText: extractPlainText(pick.msg),
      ccCandidates: Array.from(new Set(ccCandidates)),
    };
  }
}

// =================================================================
// Helpers — header / body extraction
// =================================================================

interface ReplyTarget {
  threadId: string;
  messageIdHeader: string;
  fromEmail: string;
  fromHeader: string;
  subject: string;
  bodyText: string;
  ccCandidates: string[];
}

function headerValue(
  msg: gmail_v1.Schema$Message,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === target)
    ?.value ?? undefined;
}

function extractEmail(rawHeader: string): string {
  // Match "Name <addr@host>" or bare "addr@host"
  const angle = rawHeader.match(/<([^>]+)>/);
  if (angle) return angle[1].trim();
  const bare = rawHeader.match(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return bare ? bare[0].trim() : "";
}

function extractPlainText(msg: gmail_v1.Schema$Message): string {
  // Prefer text/plain part; fall back to snippet so we always have
  // something. We deliberately don't parse HTML — keeps the prompt
  // small and avoids leaking tracking pixels into the model.
  const parts = flattenParts(msg.payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain?.body?.data) {
    try {
      return Buffer.from(plain.body.data, "base64").toString("utf-8");
    } catch {
      // fall through to snippet
    }
  }
  return msg.snippet ?? "";
}

function flattenParts(part: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!part) return [];
  const out: gmail_v1.Schema$MessagePart[] = [part];
  for (const sub of part.parts ?? []) {
    out.push(...flattenParts(sub));
  }
  return out;
}

// =================================================================
// Thread query — mirrors TransactionSummaryService's matcher
// =================================================================

function buildThreadQuery(txn: {
  contact: { fullName: string; primaryEmail: string | null };
  propertyAddress: string | null;
}): string | null {
  const parts: string[] = [];
  if (txn.contact.primaryEmail) parts.push(`from:${txn.contact.primaryEmail}`);
  if (txn.contact.primaryEmail) parts.push(`to:${txn.contact.primaryEmail}`);
  if (txn.propertyAddress) {
    const first = txn.propertyAddress.split(",")[0].trim();
    parts.push(`"${first}"`);
  }
  if (parts.length === 0) return null;
  return `(${parts.join(" OR ")}) newer_than:90d`;
}

// =================================================================
// Prompt assembly
// =================================================================

const SYSTEM_PROMPT = `You are Atlas, a real estate transaction coordinator drafting a reply email on behalf of the human TC.

Voice rules:
- Warm, terse, professional. Like a TC who knows their stuff.
- Under 80 words unless the inbound message demands more detail.
- Plain prose, no markdown, no bullet lists unless reproducing a list from the inbound message.
- No "I hope this email finds you well." No "Please don't hesitate." No corporate filler.
- Sign off as "Atlas" or leave unsigned — the human will fix.

Information rules (CRITICAL):
- NEVER invent: prices, earnest money figures, commission amounts, dates, license numbers, addresses, names of people, names of title/lender companies. If you need a fact you don't have, leave a [PLACEHOLDER: what you need] tag for the human to fill.
- Repeat back specifics ONLY if they appear verbatim in the transaction context or the inbound message.
- If the inbound asks a question you can't answer from context, acknowledge + commit to follow up. Don't bluff.

Output format:
Return strict JSON with exactly these keys:
{
  "subject": "Re: <appropriate subject>",
  "body": "<plain text body>"
}
Subject must be "Re: " followed by the original subject, with any duplicate "Re: " prefixes collapsed.`;

function buildDraftPrompt(
  txn: {
    id: string;
    status: string;
    transactionType: string;
    side: string | null;
    propertyAddress: string | null;
    contractDate: Date | null;
    closingDate: Date | null;
    contact: { fullName: string; primaryEmail: string | null };
    milestones: Array<{
      label: string;
      dueAt: Date | null;
      completedAt: Date | null;
      status: string;
    }>;
    tasks: Array<{
      title: string;
      dueAt: Date | null;
    }>;
  },
  target: ReplyTarget,
): string {
  const fmt = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : "—";
  const ms = txn.milestones
    .map(
      (m) =>
        `  - ${m.label} (due ${m.dueAt ? fmt(m.dueAt) : "no date"}) ${
          m.completedAt ? "✓ done" : m.status
        }`,
    )
    .join("\n");
  const ts = txn.tasks
    .map((t) => `  - ${t.title} (due ${fmt(t.dueAt)})`)
    .join("\n");

  return `## Transaction context
- Property: ${txn.propertyAddress ?? "—"}
- Side: ${txn.side ?? "—"}  |  Type: ${txn.transactionType}  |  Status: ${txn.status}
- Primary contact: ${txn.contact.fullName}${txn.contact.primaryEmail ? ` <${txn.contact.primaryEmail}>` : ""}
- Contract date: ${fmt(txn.contractDate)}  |  Closing date: ${fmt(txn.closingDate)}

## Milestones (most relevant)
${ms || "  (none)"}

## Open tasks
${ts || "  (none)"}

## Inbound message to reply to
- From: ${target.fromHeader}
- Subject: ${target.subject}

Body:
${target.bodyText.slice(0, 4000)}

---

Draft a reply per the system rules. Return JSON only.`;
}
