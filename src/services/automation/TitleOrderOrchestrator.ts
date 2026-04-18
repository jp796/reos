/**
 * TitleOrderOrchestrator
 *
 * End-to-end flow for auto-dispositioning leads when a title company email
 * arrives. For each recent Gmail thread:
 *   1. Run TitleCompanyDetector on the latest message
 *   2. If it's a title company email, extract property addresses
 *   3. Match to an existing FUB contact (by email participants or by address)
 *   4. If matched:
 *      - Update FUB stage to `pendingStage` (default "Pending")
 *      - Create a Transaction workspace (TransactionService.createFromContact)
 *      - Create/apply a Gmail label for the address
 *      - Log every action to automation_audit_logs
 *
 * Pure orchestration — delegates to underlying services. The scan method
 * is idempotent within a thread (Transaction create is already idempotent
 * per contact; label apply is idempotent).
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient, Contact, Transaction } from "@prisma/client";
import type { gmail_v1 } from "googleapis";
import type { GmailService } from "@/services/integrations/GmailService";
import type { GmailLabelService } from "@/services/integrations/GmailLabelService";
import type {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";
import { TransactionService } from "@/services/core/TransactionService";
import {
  detectTitleCompanyEmail,
  type DetectionResult,
} from "@/services/ai/TitleCompanyDetector";
import {
  extractAddresses,
  normalizeAddress,
  addressToLabel,
  type ParsedAddress,
} from "@/lib/address-parser";
import {
  inferTransactionType,
  inferSide,
} from "@/services/core/TransactionService";

// ==================================================
// CONFIG
// ==================================================

export interface TitleOrchestratorConfig {
  /** FUB stage to set when a title-order email lands. Default "Pending". */
  pendingStage?: string;
  /** Detector confidence threshold for auto-apply. Default 0.7. */
  confidenceThreshold?: number;
  /** Max Gmail threads to scan per run. Default 50. */
  maxThreads?: number;
  /** Days back to search Gmail. Default 7. */
  daysBack?: number;
  /** Gmail label prefix. Default "REOS/Transactions" (handled by GmailLabelService). */
  labelPrefix?: string;
  /**
   * Emails that represent the account owner / team / agent itself.
   * These are excluded from participant-based contact matching so a
   * title-company email addressed TO the agent doesn't match the agent
   * as if they were a client.
   */
  selfEmails?: string[];
}

const DEFAULTS = {
  pendingStage: "Pending",
  confidenceThreshold: 0.7,
  maxThreads: 50,
  daysBack: 7,
};

export function resolveOrchestratorConfig(
  settings: Prisma.JsonValue | null,
  overrides?: TitleOrchestratorConfig,
): Required<Omit<TitleOrchestratorConfig, "labelPrefix">> & {
  labelPrefix?: string;
} {
  let pendingStage = DEFAULTS.pendingStage;
  let confidenceThreshold = DEFAULTS.confidenceThreshold;
  let labelPrefix: string | undefined;
  let selfEmailsFromSettings: string[] = [];

  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const s = settings as Record<string, unknown>;
    const ta = s.titleAutomation;
    if (ta && typeof ta === "object" && !Array.isArray(ta)) {
      const t = ta as Record<string, unknown>;
      if (typeof t.pendingStage === "string") pendingStage = t.pendingStage;
      if (typeof t.confidenceThreshold === "number") confidenceThreshold = t.confidenceThreshold;
      if (typeof t.labelPrefix === "string") labelPrefix = t.labelPrefix;
      if (Array.isArray(t.selfEmails)) {
        selfEmailsFromSettings = (t.selfEmails as unknown[]).filter(
          (x): x is string => typeof x === "string",
        );
      }
    }
  }

  // Self-emails are ADDITIVE: combine OAuth-connected email (via overrides)
  // with any settings-configured team emails. Dedup, lowercase.
  const selfEmails = Array.from(
    new Set(
      [...selfEmailsFromSettings, ...(overrides?.selfEmails ?? [])]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  return {
    pendingStage: overrides?.pendingStage ?? pendingStage,
    confidenceThreshold: overrides?.confidenceThreshold ?? confidenceThreshold,
    maxThreads: overrides?.maxThreads ?? DEFAULTS.maxThreads,
    daysBack: overrides?.daysBack ?? DEFAULTS.daysBack,
    labelPrefix: overrides?.labelPrefix ?? labelPrefix,
    selfEmails,
  };
}

// ==================================================
// RESULT TYPES
// ==================================================

export type ScanActionKind =
  | "dispositioned"
  | "skipped-low-confidence"
  | "no-contact-match"
  | "no-title-signal"
  | "error";

export interface ScanThreadResult {
  threadId: string;
  subject: string;
  fromEmail: string;
  action: ScanActionKind;
  confidence: number;
  matchedDomain?: string;
  reasons?: string[];
  contactName?: string;
  contactId?: string;
  address?: string;
  transactionCreated?: boolean;
  labelApplied?: string;
  error?: string;
}

export interface ScanResult {
  scanned: number;
  detected: number;
  matched: number;
  dispositioned: number;
  transactionsCreated: number;
  labelsApplied: number;
  daysBack: number;
  confidenceThreshold: number;
  pendingStage: string;
  details: ScanThreadResult[];
}

// ==================================================
// ORCHESTRATOR
// ==================================================

export class TitleOrderOrchestrator {
  constructor(
    private readonly accountId: string,
    private readonly db: PrismaClient,
    private readonly gmail: GmailService,
    private readonly labels: GmailLabelService,
    private readonly fub: FollowUpBossService,
    private readonly audit: AutomationAuditService,
    private readonly txnSvc: TransactionService,
    private readonly config: Required<Omit<TitleOrchestratorConfig, "labelPrefix">> & {
      labelPrefix?: string;
    },
  ) {
    // normalize once; callers should already have lowercased but be defensive
    this.config.selfEmails = this.config.selfEmails.map((e) =>
      e.trim().toLowerCase(),
    );
  }

  async scan(): Promise<ScanResult> {
    const result: ScanResult = {
      scanned: 0,
      detected: 0,
      matched: 0,
      dispositioned: 0,
      transactionsCreated: 0,
      labelsApplied: 0,
      daysBack: this.config.daysBack,
      confidenceThreshold: this.config.confidenceThreshold,
      pendingStage: this.config.pendingStage,
      details: [],
    };

    const since = new Date();
    since.setDate(since.getDate() - this.config.daysBack);
    const gmailQuery = `newer_than:${this.config.daysBack}d`;

    const { threads } = await this.gmail.searchThreads({
      q: gmailQuery,
      maxResults: this.config.maxThreads,
    });

    for (const thread of threads) {
      result.scanned++;
      try {
        const detail = await this.processThread(thread);
        result.details.push(detail);
        if (detail.action !== "no-title-signal") result.detected++;
        if (detail.contactId) result.matched++;
        if (detail.action === "dispositioned") {
          result.dispositioned++;
          if (detail.transactionCreated) result.transactionsCreated++;
          if (detail.labelApplied) result.labelsApplied++;
        }
      } catch (err) {
        result.details.push({
          threadId: thread.id ?? "",
          subject: this.getHeader(thread, "subject") ?? "(no subject)",
          fromEmail: this.getFromEmail(thread) ?? "(unknown)",
          action: "error",
          confidence: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  // --------------------------------------------------
  // Per-thread processing
  // --------------------------------------------------

  private async processThread(
    thread: gmail_v1.Schema$Thread,
  ): Promise<ScanThreadResult> {
    const threadId = thread.id ?? "";
    const messages = thread.messages ?? [];
    const latest = messages[messages.length - 1] ?? messages[0];
    const subject = this.getHeader(thread, "subject") ?? "(no subject)";
    const fromRaw = this.getHeader(thread, "from") ?? "";
    const fromEmail = extractEmail(fromRaw) ?? fromRaw;
    const fromName = extractName(fromRaw) ?? undefined;

    const bodyText = latest ? extractPlainText(latest) : "";
    const attachmentFilenames = latest ? extractAttachmentNames(latest) : [];

    const detection = detectTitleCompanyEmail({
      fromName,
      fromEmail,
      subject,
      bodyText,
      attachmentFilenames,
    });

    if (!detection.isTitleCompany) {
      return {
        threadId,
        subject,
        fromEmail,
        action: "no-title-signal",
        confidence: detection.confidence,
        matchedDomain: detection.matchedDomain,
        reasons: detection.reasons,
      };
    }

    if (detection.confidence < this.config.confidenceThreshold) {
      return {
        threadId,
        subject,
        fromEmail,
        action: "skipped-low-confidence",
        confidence: detection.confidence,
        matchedDomain: detection.matchedDomain,
        reasons: detection.reasons,
      };
    }

    // Title company email detected — find the related contact.
    const addresses = uniqueByNormalized([
      ...extractAddresses(subject),
      ...extractAddresses(bodyText),
    ]);

    const contact = await this.matchContact(thread, addresses);
    if (!contact) {
      return {
        threadId,
        subject,
        fromEmail,
        action: "no-contact-match",
        confidence: detection.confidence,
        matchedDomain: detection.matchedDomain,
        reasons: detection.reasons,
        address: addresses[0]?.raw,
      };
    }

    // Disposition: FUB stage → Pending + Transaction + Label
    const detail = await this.disposition(
      thread,
      contact,
      detection,
      addresses[0],
    );
    return detail;
  }

  // --------------------------------------------------
  // Disposition steps
  // --------------------------------------------------

  private async disposition(
    thread: gmail_v1.Schema$Thread,
    contact: Contact,
    detection: DetectionResult,
    address: ParsedAddress | undefined,
  ): Promise<ScanThreadResult> {
    const threadId = thread.id ?? "";
    const subject = this.getHeader(thread, "subject") ?? "(no subject)";
    const fromEmail = extractEmail(this.getHeader(thread, "from") ?? "") ?? "";

    // 1. Create / find the transaction (idempotent)
    const type = inferTransactionType({
      // Pull from the raw FUB payload we stored on the contact
      type: getContactFubField<string>(contact, "type"),
      tags: getContactFubField<string[]>(contact, "tags") ?? [],
    });
    const { transaction, created: txnCreated } = await this.txnSvc.createFromContact({
      accountId: this.accountId,
      contactId: contact.id,
      fubPersonId: contact.fubPersonId ?? undefined,
      propertyAddress: address?.raw,
      city: address?.city,
      state: address?.state,
      zip: address?.zip,
      transactionType: type,
      side: inferSide(type),
    });

    // 2. Update FUB stage (best-effort: skip silently if no fubPersonId)
    let fubStageUpdated = false;
    if (contact.fubPersonId) {
      await this.fub.updatePersonStage(
        contact.fubPersonId,
        this.config.pendingStage,
        {
          reason: "title_order_auto_disposition",
          transactionId: transaction.id,
        },
      );
      fubStageUpdated = true;
    }

    // 3. Apply Gmail label (if we have an address to label by)
    let labelApplied: string | undefined;
    if (address) {
      const labelName = this.labels.labelNameFor(addressToLabel(address));
      try {
        await this.labels.applyToThread(threadId, labelName);
        labelApplied = labelName;
      } catch (err) {
        // non-fatal — disposition succeeded even if label didn't
        console.warn(`Label apply failed for thread ${threadId}:`, err);
      }
    }

    // 4. Audit log (ties all three actions together)
    await this.audit.logAction({
      accountId: this.accountId,
      transactionId: transaction.id,
      entityType: "transaction",
      entityId: transaction.id,
      ruleName: "title_order_auto_disposition",
      actionType: "update",
      sourceType: "email_analysis",
      confidenceScore: detection.confidence,
      decision: "applied",
      beforeJson: null,
      afterJson: {
        threadId,
        subject,
        fromEmail,
        matchedDomain: detection.matchedDomain,
        reasons: detection.reasons,
        contactId: contact.id,
        address: address?.raw,
        txnCreated,
        fubStageUpdated,
        pendingStage: this.config.pendingStage,
        labelApplied,
      } as Prisma.InputJsonValue,
    });

    return {
      threadId,
      subject,
      fromEmail,
      action: "dispositioned",
      confidence: detection.confidence,
      matchedDomain: detection.matchedDomain,
      reasons: detection.reasons,
      contactName: contact.fullName,
      contactId: contact.id,
      address: address?.raw,
      transactionCreated: txnCreated,
      labelApplied,
    };
  }

  // --------------------------------------------------
  // Matching
  // --------------------------------------------------

  private async matchContact(
    thread: gmail_v1.Schema$Thread,
    addresses: ParsedAddress[],
  ): Promise<Contact | null> {
    const selfSet = new Set(this.config.selfEmails);

    // Strategy 1: any participant email matches a contact primary email.
    // Exclude self emails (account owner, team, agent) so a title-company
    // email addressed TO the agent doesn't match the agent as a client.
    const participantEmails = this.extractParticipantEmails(thread).filter(
      (e) => !selfSet.has(e.toLowerCase()),
    );
    if (participantEmails.length > 0) {
      const contact = await this.db.contact.findFirst({
        where: {
          accountId: this.accountId,
          primaryEmail: { in: participantEmails, mode: "insensitive" },
          // Double defense: even if one of these participant emails IS stored
          // as a contact, exclude any contact whose own email is in the self
          // set. Catches the case where the owner is also in FUB as a contact.
          NOT: {
            primaryEmail: {
              in: this.config.selfEmails,
              mode: "insensitive",
            },
          },
        },
      });
      if (contact) return contact;
    }

    // Strategy 2: property address in subject/body matches a contact's
    // stored FUB address.
    if (addresses.length > 0) {
      const candidates = await this.db.contact.findMany({
        where: {
          accountId: this.accountId,
          rawFubPayloadJson: { not: Prisma.JsonNull },
        },
        take: 500,
      });
      for (const c of candidates) {
        const fubAddrs = getContactFubField<Array<Record<string, unknown>>>(
          c,
          "addresses",
        );
        if (!fubAddrs?.length) continue;
        for (const a of fubAddrs) {
          const n = normalizeAddress({
            street: String(a.street ?? ""),
            city: a.city ? String(a.city) : null,
            state: a.state ? String(a.state) : null,
            zip: a.code ? String(a.code) : null, // FUB uses `code` for zip
          });
          if (!n) continue;
          if (addresses.some((x) => x.normalized === n)) {
            return c;
          }
        }
      }
    }

    return null;
  }

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  private getHeader(
    thread: gmail_v1.Schema$Thread,
    name: string,
  ): string | undefined {
    const first = thread.messages?.[0];
    const hs = first?.payload?.headers ?? [];
    return hs.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
  }

  private getFromEmail(thread: gmail_v1.Schema$Thread): string | undefined {
    return extractEmail(this.getHeader(thread, "from") ?? "");
  }

  private extractParticipantEmails(thread: gmail_v1.Schema$Thread): string[] {
    const set = new Set<string>();
    for (const msg of thread.messages ?? []) {
      for (const h of msg.payload?.headers ?? []) {
        const name = h.name?.toLowerCase() ?? "";
        if (!["from", "to", "cc", "bcc"].includes(name)) continue;
        const value = h.value ?? "";
        for (const e of value.split(",")) {
          const email = extractEmail(e);
          if (email) set.add(email.toLowerCase());
        }
      }
    }
    return Array.from(set);
  }
}

// ==================================================
// PURE HELPERS
// ==================================================

function extractEmail(header: string): string | undefined {
  const m = header.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  const bare = header.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return bare?.[0];
}

function extractName(header: string): string | undefined {
  const m = header.match(/^([^<]+)</);
  return m?.[1].replace(/"/g, "").trim();
}

function extractPlainText(msg: gmail_v1.Schema$Message): string {
  if (!msg.payload) return "";
  const snippet = msg.snippet ?? "";

  // Look for text/plain part
  const walk = (part: gmail_v1.Schema$MessagePart | undefined): string => {
    if (!part) return "";
    if (part.mimeType === "text/plain" && part.body?.data) {
      try {
        return Buffer.from(part.body.data, "base64url").toString("utf8");
      } catch {
        return "";
      }
    }
    if (part.parts) {
      for (const sub of part.parts) {
        const got = walk(sub);
        if (got) return got;
      }
    }
    return "";
  };
  const text = walk(msg.payload);
  if (text) return text;

  // Fallback: HTML → strip tags
  const html = (() => {
    const walkHtml = (part: gmail_v1.Schema$MessagePart | undefined): string => {
      if (!part) return "";
      if (part.mimeType === "text/html" && part.body?.data) {
        try {
          return Buffer.from(part.body.data, "base64url").toString("utf8");
        } catch {
          return "";
        }
      }
      if (part.parts) for (const sub of part.parts) {
        const got = walkHtml(sub);
        if (got) return got;
      }
      return "";
    };
    return walkHtml(msg.payload);
  })();
  if (html) return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  return snippet;
}

function extractAttachmentNames(msg: gmail_v1.Schema$Message): string[] {
  const out: string[] = [];
  const walk = (parts: gmail_v1.Schema$MessagePart[] | undefined) => {
    if (!parts) return;
    for (const p of parts) {
      if (p.filename && p.body?.attachmentId) out.push(p.filename);
      if (p.parts) walk(p.parts);
    }
  };
  walk(msg.payload?.parts);
  return out;
}

function uniqueByNormalized(addresses: ParsedAddress[]): ParsedAddress[] {
  const seen = new Set<string>();
  const out: ParsedAddress[] = [];
  for (const a of addresses) {
    if (seen.has(a.normalized)) continue;
    seen.add(a.normalized);
    out.push(a);
  }
  return out;
}

function getContactFubField<T>(contact: Contact, key: string): T | undefined {
  const raw = contact.rawFubPayloadJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const val = (raw as Record<string, unknown>)[key];
  return val as T | undefined;
}
