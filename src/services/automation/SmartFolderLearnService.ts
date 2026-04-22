/**
 * SmartFolderLearnService
 *
 * Given a transaction's already-labeled threads in Gmail, extract
 * high-confidence patterns (sender + participant email addresses,
 * frequent subject tokens) and rewrite the Gmail filter so future
 * emails matching those patterns auto-file into the same folder.
 *
 * Idempotent: each run replaces the filter with an updated query.
 * Rewrite is a delete + create (Gmail filters are immutable).
 *
 * Safe guardrails:
 *   - Never learns the account-owner's own email (we don't want to
 *     label every email we send or receive into this folder).
 *   - Never learns generic / system emails (noreply, mailer-daemon,
 *     google-calendar-invite, etc.).
 *   - Requires minimum occurrence counts before adding a signal.
 *   - Caps final query length at Gmail's limit with safety margin.
 */

import type { PrismaClient } from "@prisma/client";
import type { GmailService } from "@/services/integrations/GmailService";
import type { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import { GmailFilterService } from "@/services/integrations/GmailFilterService";

const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const STOPWORDS = new Set([
  "re",
  "fwd",
  "fw",
  "the",
  "for",
  "your",
  "from",
  "this",
  "that",
  "with",
  "and",
  "has",
  "have",
  "been",
  "you",
  "will",
  "can",
  "was",
  "were",
  "are",
  "not",
  "new",
  "update",
  "info",
  "reply",
  "forward",
  "please",
  "thanks",
]);
const GENERIC_SENDER_RES = [
  /^noreply@/i,
  /^no-reply@/i,
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^bounce/i,
  /calendar-notification@google\.com/i,
  /@googlegroups\.com/i,
  /@google\.com$/i,
];
const MIN_EMAIL_OCCURRENCES = 2;
const MIN_TOKEN_SHARE = 0.5; // Token must appear in >=50% of threads
const MAX_LEARNED_EMAILS = 20;
const MAX_LEARNED_TOKENS = 12;
const MAX_QUERY_CHARS = 1400;

export interface LearnResult {
  ok: boolean;
  reason?: string;
  threadsScanned: number;
  learnedEmails: string[];
  learnedTokens: string[];
  oldFilterId: string | null;
  newFilterId: string | null;
  newQuery: string | null;
}

export interface LearnDeps {
  db: PrismaClient;
  gmail: GmailService;
  audit: AutomationAuditService;
  filters: GmailFilterService;
  labelId: string; // the SmartFolder label to read from
  ownerEmail: string; // skip the user's own address
  existingFilterId: string | null;
  /** Original address + contact-email query fragment to preserve */
  baseQuery: string;
}

export class SmartFolderLearnService {
  constructor(private readonly deps: LearnDeps) {}

  async learn(transactionId: string): Promise<LearnResult> {
    const { db, gmail, audit, filters, labelId, ownerEmail, existingFilterId, baseQuery } =
      this.deps;

    const { threads } = await gmail.searchThreadsPaged({
      labelIds: [labelId],
      maxTotal: 200,
    });

    const threadsScanned = threads.length;
    if (threadsScanned === 0) {
      return {
        ok: true,
        reason: "no_threads_to_learn_from",
        threadsScanned: 0,
        learnedEmails: [],
        learnedTokens: [],
        oldFilterId: existingFilterId,
        newFilterId: existingFilterId,
        newQuery: null,
      };
    }

    // --- Email frequency map
    const emailCounts = new Map<string, number>();
    // --- Subject token frequency map (thread-unique counts)
    const tokenThreadCounts = new Map<string, number>();
    const ownerLower = ownerEmail.toLowerCase();

    for (const t of threads) {
      const threadEmails = new Set<string>();
      const threadTokens = new Set<string>();

      for (const m of t.messages ?? []) {
        const hdrs = m.payload?.headers ?? [];
        for (const h of hdrs) {
          const name = (h.name ?? "").toLowerCase();
          const val = h.value ?? "";
          if (
            name === "from" ||
            name === "to" ||
            name === "cc" ||
            name === "reply-to"
          ) {
            let match: RegExpExecArray | null;
            const re = new RegExp(EMAIL_RE.source, "g");
            while ((match = re.exec(val))) {
              const addr = match[1].toLowerCase();
              if (addr === ownerLower) continue;
              if (GENERIC_SENDER_RES.some((r) => r.test(addr))) continue;
              threadEmails.add(addr);
            }
          }
          if (name === "subject") {
            const tokens = tokenize(val);
            for (const tok of tokens) threadTokens.add(tok);
          }
        }
      }
      for (const e of threadEmails) {
        emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1);
      }
      for (const tok of threadTokens) {
        tokenThreadCounts.set(tok, (tokenThreadCounts.get(tok) ?? 0) + 1);
      }
    }

    // --- Pick learned emails (≥ MIN_EMAIL_OCCURRENCES threads)
    const learnedEmails = [...emailCounts.entries()]
      .filter(([, n]) => n >= MIN_EMAIL_OCCURRENCES)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_LEARNED_EMAILS)
      .map(([e]) => e);

    // --- Pick learned tokens (appear in ≥ MIN_TOKEN_SHARE of threads)
    const minCount = Math.max(2, Math.ceil(threadsScanned * MIN_TOKEN_SHARE));
    const learnedTokens = [...tokenThreadCounts.entries()]
      .filter(([tok, n]) => n >= minCount && !STOPWORDS.has(tok) && tok.length >= 4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_LEARNED_TOKENS)
      .map(([tok]) => tok);

    if (learnedEmails.length === 0 && learnedTokens.length === 0) {
      return {
        ok: true,
        reason: "no_high_confidence_signals",
        threadsScanned,
        learnedEmails: [],
        learnedTokens: [],
        oldFilterId: existingFilterId,
        newFilterId: existingFilterId,
        newQuery: null,
      };
    }

    // --- Build the new query: base (contact email + address) OR learned.
    const additions: string[] = [];
    if (learnedEmails.length > 0) {
      const joined = learnedEmails.join(" OR ");
      additions.push(
        `(from:(${joined}) OR to:(${joined}) OR cc:(${joined}))`,
      );
    }
    for (const tok of learnedTokens) {
      additions.push(`subject:"${tok}"`);
    }
    let newQuery = [baseQuery, ...additions].join(" OR ");

    // Cap length — Gmail filter query limit ~1500 chars.
    if (newQuery.length > MAX_QUERY_CHARS) {
      // Drop tokens first, then trim emails list
      while (newQuery.length > MAX_QUERY_CHARS && additions.length > 1) {
        additions.pop();
        newQuery = [baseQuery, ...additions].join(" OR ");
      }
    }

    // --- Rewrite filter: delete old + create new. Label id stays the same.
    if (existingFilterId) {
      try {
        await filters.deleteFilter(existingFilterId);
      } catch (err) {
        console.warn(
          "learn: failed to delete old filter (continuing to create new):",
          err instanceof Error ? err.message : err,
        );
      }
    }

    let newFilterId: string | null = null;
    try {
      newFilterId = await filters.createFilter({
        query: newQuery,
        labelId,
      });
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        threadsScanned,
        learnedEmails,
        learnedTokens,
        oldFilterId: existingFilterId,
        newFilterId: null,
        newQuery,
      };
    }

    await db.transaction.update({
      where: { id: transactionId },
      data: { smartFolderFilterId: newFilterId },
    });

    await audit.logAction({
      accountId: (await db.transaction.findUnique({
        where: { id: transactionId },
        select: { accountId: true },
      }))!.accountId,
      transactionId,
      entityType: "transaction",
      entityId: transactionId,
      ruleName: "smart_folder_learn",
      actionType: "update",
      sourceType: "email_analysis",
      confidenceScore: 1.0,
      decision: "applied",
      beforeJson: {
        oldFilterId: existingFilterId,
      },
      afterJson: {
        newFilterId,
        threadsScanned,
        learnedEmails,
        learnedTokens,
        newQuery,
      },
    });

    return {
      ok: true,
      threadsScanned,
      learnedEmails,
      learnedTokens,
      oldFilterId: existingFilterId,
      newFilterId,
      newQuery,
    };
  }
}

/**
 * Simple tokenizer: lowercase, drop punctuation, drop tokens shorter than
 * 4 chars or starting with a digit. Keeps names and proper nouns
 * (e.g. "windmill", "farnsworth", "schmidt").
 */
function tokenize(subject: string): string[] {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 4 &&
        !/^\d/.test(t) &&
        !STOPWORDS.has(t),
    );
}
