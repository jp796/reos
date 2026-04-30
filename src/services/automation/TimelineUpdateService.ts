/**
 * TimelineUpdateService
 *
 * Scans a transaction's labeled Gmail threads for milestone-completion
 * signals and marks the corresponding Milestone rows complete, so the
 * Timeline / "overdue" indicator reflects reality instead of showing
 * every deadline as pending forever.
 *
 * First wire-up: earnest-money receipt detection. Extensible to:
 *   - inspection completed (report delivered)
 *   - appraisal completed (report delivered)
 *   - title commitment delivered
 *   - clear-to-close (lender notice)
 *   - closing docs received
 *
 * Best-effort: never throws, always returns a result object with
 * counts + per-txn details the caller can audit.
 */

import type { PrismaClient } from "@prisma/client";
import type { GmailService } from "@/services/integrations/GmailService";
import type { AutomationAuditService } from "@/services/integrations/FollowUpBossService";

export interface TimelineScanResult {
  scanned: number;
  completed: number;
  details: Array<{
    transactionId: string;
    address: string | null;
    milestoneType: string;
    completedAt: string;
    matchedSubject: string;
    matchedVia: "subject" | "filename";
  }>;
}

/** Patterns that indicate earnest-money receipt / deposit confirmation */
const EM_SUBJECT_RES: RegExp[] = [
  /\bearnest\s+money\b[^\n]{0,80}(?:receipt|received|deposited|confirm|clear)/i,
  /\bEM\s+receipt\b/i,
  /deposit\s+(?:received|confirmation)/i,
  /wire\s+(?:received|confirmation|confirm)/i,
  /earnest\s+money.*received/i,
];
const EM_FILENAME_RES: RegExp[] = [
  /earnest[_\s-]*money/i,
  /em[_\s-]*receipt/i,
  /deposit[_\s-]*(?:confirmation|receipt)/i,
  /wire[_\s-]*(?:confirm|receipt)/i,
];

export class TimelineUpdateService {
  constructor(
    private readonly db: PrismaClient,
    private readonly gmail: GmailService,
    private readonly audit: AutomationAuditService,
  ) {}

  /**
   * Scan earnest-money receipts for every open transaction that has
   * a pending earnest_money milestone. Marks the milestone completed
   * using the detected email's date.
   */
  async scanEarnestMoney(accountId: string): Promise<TimelineScanResult> {
    const result: TimelineScanResult = { scanned: 0, completed: 0, details: [] };

    // Open transactions with an earnest_money milestone not yet completed.
    const txns = await this.db.transaction.findMany({
      where: {
        accountId,
        status: { notIn: ["closed", "dead"] },
        milestones: {
          some: {
            type: "earnest_money",
            completedAt: null,
          },
        },
      },
      include: {
        milestones: {
          where: { type: "earnest_money", completedAt: null },
          take: 1,
        },
      },
    });

    for (const txn of txns) {
      result.scanned++;
      const milestone = txn.milestones[0];
      if (!milestone) continue;

      const labelFilter =
        txn.smartFolderLabelId && txn.propertyAddress
          ? `label:"REOS/Transactions/${labelSegment(txn.propertyAddress)}"`
          : null;

      // Scope the search. Three paths in order of precision:
      //   A. SmartFolder label   — strongest
      //   B. Subject contains the property address
      //   C. From: any known participant on this deal + EM keyword
      //      ← catches title-coordinator emails like "Deposit" /
      //         "Earnest money" that omit the address.
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const sinceToken = formatGmailDate(since);
      const queries: string[] = [];
      if (labelFilter) {
        queries.push(`${labelFilter} after:${sinceToken}`);
      }
      if (txn.propertyAddress) {
        queries.push(
          `subject:"${shortAddress(txn.propertyAddress)}" after:${sinceToken}`,
        );
      }
      // Pull participant sender emails (service providers + primary
      // contact). Cap at 12 to keep the OR clause workable.
      const participantEmails = await this.db.transactionParticipant.findMany({
        where: {
          transactionId: txn.id,
          contact: { primaryEmail: { not: null } },
        },
        include: { contact: { select: { primaryEmail: true } } },
        take: 12,
      });
      const senderEmails = new Set<string>();
      for (const p of participantEmails) {
        if (p.contact.primaryEmail) senderEmails.add(p.contact.primaryEmail);
      }
      // Add the primary contact too — they sometimes forward EM
      // confirmations from the title co.
      const primary = await this.db.transaction.findUnique({
        where: { id: txn.id },
        select: { contact: { select: { primaryEmail: true } } },
      });
      if (primary?.contact?.primaryEmail) {
        senderEmails.add(primary.contact.primaryEmail);
      }
      if (senderEmails.size > 0) {
        const fromOr = [...senderEmails]
          .map((e) => `from:"${e.replace(/"/g, "")}"`)
          .join(" OR ");
        queries.push(
          `(${fromOr}) (earnest OR deposit OR wire OR escrow OR receipt) after:${sinceToken}`,
        );
      }
      if (queries.length === 0) continue;

      // Search once per EM pattern so we catch subject-based matches
      // that don't share keywords.
      let found: {
        subject: string;
        date: Date;
        matchedVia: "subject" | "filename";
      } | null = null;

      try {
        for (const q of queries) {
          // First two queries already include the EM-keyword scope at
          // the call site; the participant-sender query embeds it
          // already.
          const isParticipantQuery = q.includes("from:");
          const fullQuery = isParticipantQuery
            ? q
            : `${q} (earnest OR deposit OR wire OR escrow OR receipt)`;
          const { threads } = await this.gmail.searchThreadsPaged({
            q: fullQuery,
            maxTotal: 30,
          });
          for (const t of threads) {
            if (!t.messages) continue;
            for (const m of t.messages) {
              if (!m.id) continue;
              const subject =
                m.payload?.headers?.find(
                  (h) => h.name?.toLowerCase() === "subject",
                )?.value ?? "";
              const dateStr =
                m.payload?.headers?.find(
                  (h) => h.name?.toLowerCase() === "date",
                )?.value ?? null;
              const msgDate = dateStr ? new Date(dateStr) : new Date();

              // Subject match?
              if (EM_SUBJECT_RES.some((re) => re.test(subject))) {
                found = { subject, date: msgDate, matchedVia: "subject" };
                break;
              }
              // Filename match on attachments?
              const atts = await this.gmail.getMessageAttachments(m.id);
              if (
                atts.some((a) =>
                  EM_FILENAME_RES.some((re) => re.test(a.filename)),
                )
              ) {
                found = { subject, date: msgDate, matchedVia: "filename" };
                break;
              }
            }
            if (found) break;
          }
          if (found) break;
        }
      } catch (err) {
        console.warn(
          `EM scan failed for ${txn.id}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }

      if (!found) continue;

      await this.db.milestone.update({
        where: { id: milestone.id },
        data: { completedAt: found.date, status: "completed" },
      });
      result.completed++;
      result.details.push({
        transactionId: txn.id,
        address: txn.propertyAddress,
        milestoneType: "earnest_money",
        completedAt: found.date.toISOString(),
        matchedSubject: found.subject.slice(0, 120),
        matchedVia: found.matchedVia,
      });

      await this.audit.logAction({
        accountId,
        transactionId: txn.id,
        entityType: "milestone",
        entityId: milestone.id,
        ruleName: "timeline_em_auto_complete",
        actionType: "update",
        sourceType: "email_analysis",
        confidenceScore: found.matchedVia === "filename" ? 0.95 : 0.85,
        decision: "applied",
        beforeJson: null,
        afterJson: {
          milestoneType: "earnest_money",
          completedAt: found.date.toISOString(),
          matchedSubject: found.subject.slice(0, 160),
          matchedVia: found.matchedVia,
        },
      });
    }

    return result;
  }
}

function labelSegment(address: string): string {
  return address.replace(/\//g, "—").trim().slice(0, 150);
}
function shortAddress(address: string): string {
  // Trim to street-number + street-name + suffix (~3 tokens). Subject
  // lines like "Re: 3327 Thomas rd earnest money" carry the street
  // but rarely the city — using "3327 Thomas Rd Cheyenne" as the
  // search anchor would miss the email entirely.
  const beforeComma = address.split(",")[0]?.trim() ?? address;
  const tokens = beforeComma.split(/\s+/);
  return tokens.slice(0, 3).join(" ");
}
function formatGmailDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}
