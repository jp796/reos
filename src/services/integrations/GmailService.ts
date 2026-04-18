/**
 * GmailService
 *
 * Ported from architecture artifact with fixes:
 *  - PrismaClient + OAuth2Client imports wired
 *  - `error.message`/`error.code` on unknown narrowed via instanceof / gaxios response
 *  - Shape of Gmail API types uses googleapis gmail_v1.Schema$Thread etc
 *    rather than the hand-rolled GmailThread for actual API calls
 *  - Real matching delegated to EmailTransactionMatchingService (unchanged shape)
 *
 * Note: this is a FOUNDATION port — AI summary/extraction methods stub out
 * until the AI layer lands (Phase 4 of roadmap).
 */

import { EventEmitter } from "node:events";
import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { Contact, Transaction } from "@/types";
import { makeSafeGmail } from "@/lib/gmail-guard";

// ==================================================
// CONFIG & TYPES
// ==================================================

export interface GmailConfig {
  labelPrefix: string;
  autoOrganizeThreads: boolean;
  extractAttachments: boolean;
  batchSize: number;
  rateLimitDelayMs: number;
}

export interface EmailMatchResult {
  threadId: string;
  transactionId: string;
  confidence: number;
  matchReasons: string[];
}

export interface AttachmentInfo {
  attachmentId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailSyncResult {
  threadsProcessed: number;
  messagesProcessed: number;
  attachmentsFound: number;
  matchesMade: number;
  communicationEventsCreated: number;
  errors: Array<{ type: string; id: string; error: string }>;
}

// ==================================================
// MATCHING SERVICE
// ==================================================

const REAL_ESTATE_KEYWORDS = [
  "contract",
  "closing",
  "inspection",
  "appraisal",
  "lender",
  "mortgage",
  "title company",
  "settlement",
  "walkthrough",
  "earnest money",
  "real estate",
  "property",
  "house",
  "home",
  "listing",
  "mls",
];

export class EmailTransactionMatchingService {
  findMatches(
    thread: gmail_v1.Schema$Thread,
    transactions: Array<Transaction & { contact: Contact }>,
  ): EmailMatchResult[] {
    if (!thread.messages || thread.messages.length === 0) return [];

    const matches: EmailMatchResult[] = [];
    for (const txn of transactions) {
      const confidence = this.scoreMatch(thread, txn);
      if (confidence > 0.5) {
        matches.push({
          threadId: thread.id ?? "",
          transactionId: txn.id,
          confidence,
          matchReasons:
            confidence > 0.8
              ? ["High confidence match"]
              : confidence > 0.6
                ? ["Good confidence match"]
                : ["Possible match"],
        });
      }
    }
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  private scoreMatch(
    thread: gmail_v1.Schema$Thread,
    txn: Transaction & { contact: Contact },
  ): number {
    let score = 0;
    const text = this.threadText(thread).toLowerCase();
    const emails = this.threadEmails(thread);

    // 1. Email match (0.4)
    if (
      txn.contact.primaryEmail &&
      emails.some((e) =>
        e.toLowerCase().includes(txn.contact.primaryEmail!.toLowerCase()),
      )
    ) {
      score += 0.4;
    }

    // 2. Address match (0.3 weighted)
    if (txn.propertyAddress) {
      const parts = txn.propertyAddress.toLowerCase().split(/[\s,]+/);
      const hits = parts.filter((p) => p.length > 2 && text.includes(p)).length;
      if (parts.length > 0) score += 0.3 * (hits / parts.length);
    }

    // 3. Name match (0.2 weighted)
    if (txn.contact.fullName) {
      const parts = txn.contact.fullName.toLowerCase().split(/\s+/);
      const hits = parts.filter((p) => p.length > 2 && text.includes(p)).length;
      if (parts.length > 0) score += 0.2 * (hits / parts.length);
    }

    // 4. Real estate keywords (0.1 weighted)
    const kwHits = REAL_ESTATE_KEYWORDS.filter((k) => text.includes(k)).length;
    if (REAL_ESTATE_KEYWORDS.length > 0) {
      score += 0.1 * Math.min(kwHits / REAL_ESTATE_KEYWORDS.length, 1);
    }

    return Math.min(score, 1);
  }

  private threadText(thread: gmail_v1.Schema$Thread): string {
    if (!thread.messages) return "";
    const parts: string[] = [];
    for (const msg of thread.messages) {
      const headers = msg.payload?.headers ?? [];
      const subject = headers.find(
        (h) => h.name?.toLowerCase() === "subject",
      )?.value;
      if (subject) parts.push(subject);
      const bodyData = msg.payload?.body?.data;
      if (bodyData) {
        try {
          parts.push(Buffer.from(bodyData, "base64url").toString("utf8"));
        } catch {
          /* ignore */
        }
      }
    }
    return parts.join(" ");
  }

  private threadEmails(thread: gmail_v1.Schema$Thread): string[] {
    const set = new Set<string>();
    const rx = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    if (!thread.messages) return [];
    for (const msg of thread.messages) {
      const headers = msg.payload?.headers ?? [];
      for (const h of headers) {
        const name = h.name?.toLowerCase() ?? "";
        if (["from", "to", "cc", "bcc"].includes(name) && h.value) {
          const m = h.value.match(rx);
          if (m) m.forEach((x) => set.add(x));
        }
      }
    }
    return Array.from(set);
  }
}

// ==================================================
// GMAIL SERVICE
// ==================================================

export class GmailService extends EventEmitter {
  private readonly gmail: gmail_v1.Gmail;

  constructor(
    private readonly accountId: string,
    auth: OAuth2Client,
    private readonly config: GmailConfig,
    private readonly db: PrismaClient,
    private readonly matching: EmailTransactionMatchingService,
  ) {
    super();
    // makeSafeGmail wraps the Gmail client so destructive methods
    // (delete, trash, send, batchDelete, batchModify, import, insert)
    // throw at call time. See src/lib/gmail-guard.ts.
    this.gmail = makeSafeGmail(auth);
  }

  // --------------------------------------------------
  // Threads
  // --------------------------------------------------

  async searchThreads(query: {
    q?: string;
    maxResults?: number;
    pageToken?: string;
    labelIds?: string[];
  }): Promise<{
    threads: gmail_v1.Schema$Thread[];
    nextPageToken?: string;
    resultSizeEstimate: number;
  }> {
    const res = await this.gmail.users.threads.list({
      userId: "me",
      q: query.q,
      maxResults: query.maxResults ?? 50,
      pageToken: query.pageToken,
      labelIds: query.labelIds,
    });
    const threads: gmail_v1.Schema$Thread[] = [];
    for (const t of res.data.threads ?? []) {
      if (!t.id) continue;
      const full = await this.getThread(t.id);
      if (full) threads.push(full);
    }
    return {
      threads,
      nextPageToken: res.data.nextPageToken ?? undefined,
      resultSizeEstimate: res.data.resultSizeEstimate ?? 0,
    };
  }

  async getThread(threadId: string): Promise<gmail_v1.Schema$Thread | null> {
    try {
      const res = await this.gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      });
      return res.data;
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  // --------------------------------------------------
  // Matching
  // --------------------------------------------------

  async organizeThreadsByTransaction(): Promise<EmailMatchResult[]> {
    const transactions = await this.db.transaction.findMany({
      where: { accountId: this.accountId },
      include: { contact: true },
    });
    if (transactions.length === 0) return [];

    const queries = [
      "contract OR closing OR inspection OR appraisal",
      "lender OR mortgage OR financing",
      "title company OR settlement OR attorney",
      "real estate OR property OR home OR house",
      "MLS OR listing OR showing",
    ];
    const out: EmailMatchResult[] = [];
    for (const q of queries) {
      try {
        const { threads } = await this.searchThreads({ q, maxResults: 100 });
        for (const t of threads) {
          out.push(...this.matching.findMatches(t, transactions));
          await this.sleep();
        }
      } catch (err) {
        console.error(`Gmail query "${q}" failed:`, err);
      }
    }
    return out;
  }

  async linkThreadToTransaction(
    threadId: string,
    transactionId: string,
    confidence = 1,
  ): Promise<void> {
    const thread = await this.getThread(threadId);
    if (!thread) throw new Error(`Gmail thread ${threadId} not found`);

    const headers = thread.messages?.[0]?.payload?.headers ?? [];
    const subject =
      headers.find((h) => h.name?.toLowerCase() === "subject")?.value ??
      "No Subject";
    const lastMsg = thread.messages?.[thread.messages.length - 1];
    const happenedAt = lastMsg?.internalDate
      ? new Date(parseInt(lastMsg.internalDate, 10))
      : new Date();

    await this.db.communicationEvent.create({
      data: {
        transactionId,
        type: "email",
        source: "gmail",
        subject,
        happenedAt,
        rawPayloadJson: {
          threadId,
          confidence,
          messageCount: thread.messages?.length ?? 0,
        } satisfies Prisma.InputJsonValue,
      },
    });

    this.emit("threadLinked", { threadId, transactionId, confidence });
  }

  // --------------------------------------------------
  // Attachments
  // --------------------------------------------------

  async getMessageAttachments(messageId: string): Promise<AttachmentInfo[]> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });
      const attachments: AttachmentInfo[] = [];
      const walk = (parts: gmail_v1.Schema$MessagePart[] | undefined) => {
        if (!parts) return;
        for (const p of parts) {
          if (p.body?.attachmentId && p.filename) {
            attachments.push({
              attachmentId: p.body.attachmentId,
              messageId,
              filename: p.filename,
              mimeType: p.mimeType ?? "application/octet-stream",
              size: p.body.size ?? 0,
            });
          }
          if (p.parts) walk(p.parts);
        }
      };
      walk(res.data.payload?.parts);
      return attachments;
    } catch (err) {
      console.error(`Failed attachments for ${messageId}:`, err);
      return [];
    }
  }

  async downloadAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const res = await this.gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });
    if (!res.data.data) {
      throw new Error("No attachment data returned");
    }
    return Buffer.from(res.data.data, "base64url");
  }

  // --------------------------------------------------
  // Utils
  // --------------------------------------------------

  private sleep(): Promise<void> {
    return new Promise((r) => setTimeout(r, this.config.rateLimitDelayMs));
  }

  private isNotFound(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const maybe = err as { code?: number; response?: { status?: number } };
    return maybe.code === 404 || maybe.response?.status === 404;
  }
}
