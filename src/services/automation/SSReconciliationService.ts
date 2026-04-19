/**
 * SSReconciliationService
 *
 * Implements the SSReconciliation skill spec (see
 * ~/.claude/skills/SSReconciliation/SKILL.md).
 *
 * For each email in a user-configured time window:
 *   1. Skip if sender is not a known title domain / signal carrier
 *   2. Download attachments; skip if none look like a Settlement
 *      Statement / Closing Disclosure / ALTA / HUD-1
 *   3. Extract parties (buyers, sellers) + disbursement date from PDF
 *   4. Match each party to a FUB contact (exact fullName / nameVariants /
 *      property-address match on their stored FUB addresses)
 *   5. Queue a PendingClosingDateUpdate row per (contact, side,
 *      propertyAddress) pair with proposedStage='Closed'
 *
 * Always queue-first. The user clicks Apply in the UI to push the FUB
 * stage change + local status transition — never auto-applied here.
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient, Contact } from "@prisma/client";
import type { GmailService } from "@/services/integrations/GmailService";
import type { DocumentExtractionService, SettlementParties } from "@/services/ai/DocumentExtractionService";
import { safeForDb } from "@/services/ai/DocumentExtractionService";
import type { TransactionService } from "@/services/core/TransactionService";
import {
  detectTitleCompanyEmail,
} from "@/services/ai/TitleCompanyDetector";
import { nameVariants } from "@/lib/subject-parser";
import { extractAddresses, normalizeAddress } from "@/lib/address-parser";

const SETTLEMENT_PATTERNS: readonly RegExp[] = [
  /settlement[_\s-]*statement/i,
  /closing[_\s-]*disclosure/i,
  /alta.*settlement/i,
  /\bcd\b.*\.pdf$/i,
  /hud[-\s]?1/i,
  /final.*cd/i,
  /final.*settlement/i,
];

export interface ReconciliationResult {
  scanned: number;
  withAttachments: number;
  ssCandidates: number;
  parsed: number;
  partiesFound: number;
  contactsMatched: number;
  queued: number;
  errors: Array<{ threadId: string; error: string }>;
  details: Array<{
    threadId: string;
    subject: string;
    filename: string;
    closingDate?: string;
    buyers: string[];
    sellers: string[];
    matched: Array<{
      contactId: string;
      contactName: string;
      side: "buy" | "sell";
      queuedId?: string;
      skipped?: string;
    }>;
  }>;
}

export class SSReconciliationService {
  constructor(
    private readonly accountId: string,
    private readonly db: PrismaClient,
    private readonly gmail: GmailService,
    private readonly extraction: DocumentExtractionService,
    private readonly txnSvc: TransactionService,
    private readonly selfEmails: string[] = [],
    /** Name fragments that identify the account owner (agent). Used to
     *  filter them out of party-match candidates so the agent doesn't
     *  end up queued as a buyer/seller on their own deals. */
    private readonly selfNameFragments: string[] = [],
  ) {}

  /** Check whether a party name matches any self-name fragment. */
  private isSelfName(name: string): boolean {
    if (this.selfNameFragments.length === 0) return false;
    const lower = name.toLowerCase();
    return this.selfNameFragments.some((frag) =>
      lower.includes(frag.toLowerCase()),
    );
  }

  async reconcileRecent(options: {
    daysBack?: number;
    maxThreads?: number;
  } = {}): Promise<ReconciliationResult> {
    const daysBack = options.daysBack ?? 365;
    const maxThreads = options.maxThreads ?? 2000;

    const result: ReconciliationResult = {
      scanned: 0,
      withAttachments: 0,
      ssCandidates: 0,
      parsed: 0,
      partiesFound: 0,
      contactsMatched: 0,
      queued: 0,
      errors: [],
      details: [],
    };

    // Query Gmail for anything with a likely SS attachment in the window.
    // has:attachment filters to threads with at least one attachment.
    const q = `newer_than:${daysBack}d has:attachment (settlement OR closing OR disclosure OR ALTA OR HUD OR title)`;
    const { threads } = await this.gmail.searchThreadsPaged({
      q,
      maxTotal: maxThreads,
    });

    for (const thread of threads) {
      result.scanned++;
      try {
        await this.processThread(thread, result);
      } catch (err) {
        result.errors.push({
          threadId: thread.id ?? "",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  private async processThread(
    thread: import("googleapis").gmail_v1.Schema$Thread,
    result: ReconciliationResult,
  ): Promise<void> {
    const threadId = thread.id ?? "";
    const firstMsg = thread.messages?.[0];
    const subject =
      firstMsg?.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
    const fromRaw = firstMsg?.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
    const fromEmail =
      /<([^>]+)>/.exec(fromRaw)?.[1] ??
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(fromRaw)?.[0] ??
      "";

    // Identity gate — only process title-company email
    const detection = detectTitleCompanyEmail({
      fromEmail,
      fromName: /^([^<]+)</.exec(fromRaw)?.[1],
      subject,
      bodyText: "",
      attachmentFilenames: [],
    });
    if (!detection.matchedDomain) return;

    // Collect attachments across all messages; filter to SS candidates.
    const ssAttachments: Array<{
      messageId: string;
      attachmentId: string;
      filename: string;
    }> = [];
    for (const msg of thread.messages ?? []) {
      if (!msg.id) continue;
      const atts = await this.gmail.getMessageAttachments(msg.id);
      if (atts.length === 0) continue;
      result.withAttachments++;
      for (const a of atts) {
        if (SETTLEMENT_PATTERNS.some((p) => p.test(a.filename))) {
          ssAttachments.push({
            messageId: msg.id,
            attachmentId: a.attachmentId,
            filename: a.filename,
          });
        }
      }
    }
    if (ssAttachments.length === 0) return;
    result.ssCandidates += ssAttachments.length;

    for (const att of ssAttachments) {
      let buf: Buffer;
      try {
        buf = await this.gmail.downloadAttachment(att.messageId, att.attachmentId);
      } catch (err) {
        result.errors.push({
          threadId,
          error: `download ${att.filename}: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      const [extraction, parties] = await Promise.all([
        this.extraction.extractClosingDate(buf),
        this.extraction.extractParties(buf),
      ]);
      result.parsed++;
      if (!extraction || !parties) continue;
      if (parties.buyers.length === 0 && parties.sellers.length === 0) continue;
      result.partiesFound++;

      const detail: ReconciliationResult["details"][number] = {
        threadId,
        subject,
        filename: att.filename,
        closingDate: extraction.date.toISOString(),
        buyers: parties.buyers,
        sellers: parties.sellers,
        matched: [],
      };

      // Match each buyer → queue buy-side row
      for (const buyer of parties.buyers) {
        if (this.isSelfName(buyer)) continue;
        const contact = await this.matchContact(buyer, parties);
        if (!contact) continue;
        result.contactsMatched++;
        const queued = await this.queueForReview(
          contact,
          "buy",
          extraction,
          parties,
          att,
          threadId,
        );
        detail.matched.push({
          contactId: contact.id,
          contactName: contact.fullName,
          side: "buy",
          queuedId: queued?.id,
          skipped: queued ? undefined : "dedup: existing pending/applied row",
        });
        if (queued) result.queued++;
      }

      // Match each seller → queue sell-side row
      for (const seller of parties.sellers) {
        if (this.isSelfName(seller)) continue;
        const contact = await this.matchContact(seller, parties);
        if (!contact) continue;
        result.contactsMatched++;
        const queued = await this.queueForReview(
          contact,
          "sell",
          extraction,
          parties,
          att,
          threadId,
        );
        detail.matched.push({
          contactId: contact.id,
          contactName: contact.fullName,
          side: "sell",
          queuedId: queued?.id,
          skipped: queued ? undefined : "dedup: existing pending/applied row",
        });
        if (queued) result.queued++;
      }

      result.details.push(detail);
    }
  }

  // --------------------------------------------------
  // Contact matching (shared with title-order matching)
  // --------------------------------------------------

  private async matchContact(
    partyName: string,
    parties: SettlementParties,
  ): Promise<Contact | null> {
    const selfSet = new Set(this.selfEmails.map((e) => e.toLowerCase()));
    const notSelf: Prisma.ContactWhereInput = {
      NOT: {
        primaryEmail: { in: this.selfEmails, mode: "insensitive" as const },
      },
    };

    for (const variant of nameVariants(partyName)) {
      const parts = variant.split(/\s+/).filter(Boolean);
      const clause: Prisma.ContactWhereInput =
        parts.length >= 2
          ? {
              AND: parts.map((p) => ({
                fullName: { contains: p, mode: "insensitive" as const },
              })),
            }
          : {
              fullName: { contains: variant, mode: "insensitive" as const },
            };
      const contact = await this.db.contact.findFirst({
        where: {
          accountId: this.accountId,
          ...clause,
          ...notSelf,
        },
      });
      if (contact && !selfSet.has((contact.primaryEmail ?? "").toLowerCase())) {
        return contact;
      }
    }

    // Address fallback
    if (parties.propertyAddress) {
      const parsed = extractAddresses(parties.propertyAddress)[0];
      if (parsed) {
        const candidates = await this.db.contact.findMany({
          where: {
            accountId: this.accountId,
            rawFubPayloadJson: { not: Prisma.JsonNull },
            ...notSelf,
          },
          take: 1000,
        });
        for (const c of candidates) {
          const raw = c.rawFubPayloadJson;
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const addrs = (raw as Record<string, unknown>).addresses;
          if (!Array.isArray(addrs)) continue;
          for (const a of addrs) {
            if (!a || typeof a !== "object") continue;
            const ar = a as Record<string, unknown>;
            const n = normalizeAddress({
              street: String(ar.street ?? ""),
              city: ar.city ? String(ar.city) : null,
              state: ar.state ? String(ar.state) : null,
              zip: ar.code ? String(ar.code) : null,
            });
            if (n && parsed.normalized === n) return c;
          }
        }
      }
    }

    return null;
  }

  // --------------------------------------------------
  // Queueing
  // --------------------------------------------------

  private async queueForReview(
    contact: Contact,
    side: "buy" | "sell",
    extraction: { date: Date; confidence: number; anchor: string; documentType: string; snippet: string },
    parties: SettlementParties,
    att: { messageId: string; attachmentId: string; filename: string },
    threadId: string,
  ): Promise<{ id: string } | null> {
    // Idempotency: if a transaction already exists for this contact+property
    // and we've already queued (or applied) for that extractedDate, skip.
    const txn = await this.txnSvc.createFromContact({
      accountId: this.accountId,
      contactId: contact.id,
      fubPersonId: contact.fubPersonId ?? undefined,
      transactionType: side === "buy" ? "buyer" : "seller",
      side,
      propertyAddress: parties.propertyAddress,
      status: "active", // queue row will flip to closed on Apply
    });

    const existing = await this.db.pendingClosingDateUpdate.findUnique({
      where: {
        transactionId_extractedDate: {
          transactionId: txn.transaction.id,
          extractedDate: extraction.date,
        },
      },
    });
    if (existing && existing.status !== "ignored") return null;

    const row = await this.db.pendingClosingDateUpdate.upsert({
      where: {
        transactionId_extractedDate: {
          transactionId: txn.transaction.id,
          extractedDate: extraction.date,
        },
      },
      update: {
        confidence: extraction.confidence,
        snippet: safeForDb(extraction.snippet),
        anchor: extraction.anchor,
        documentType: extraction.documentType,
        threadId,
        attachmentId: att.attachmentId,
        previousDate: txn.transaction.closingDate,
        proposedStage: "Closed",
        side,
        status: "pending",
      },
      create: {
        accountId: this.accountId,
        transactionId: txn.transaction.id,
        threadId,
        attachmentId: att.attachmentId,
        documentType: extraction.documentType,
        anchor: extraction.anchor,
        extractedDate: extraction.date,
        previousDate: txn.transaction.closingDate,
        confidence: extraction.confidence,
        snippet: safeForDb(extraction.snippet),
        proposedStage: "Closed",
        side,
      },
    });
    return { id: row.id };
  }
}
