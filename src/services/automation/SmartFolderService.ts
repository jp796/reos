/**
 * SmartFolderService
 *
 * Wires a transaction to a Gmail "smart folder" (a label + filter).
 * For every transaction created on or after the SMART_FOLDER_CUTOFF:
 *
 *   1. Ensure a label "REOS/Transactions/<address>" exists
 *   2. Backfill: scan last N days of threads matching the
 *      contact's email(s) or the property address in subject —
 *      label each matching thread
 *   3. Create a Gmail filter: any future incoming message matching
 *      the same criteria gets the label auto-applied
 *   4. Persist labelId + filterId + setupAt on the transaction
 *
 * Best-effort & idempotent: if the transaction already has a
 * filterId, the whole flow is skipped. Failures are swallowed after
 * being logged to the audit table — the caller never blocks on
 * SmartFolder setup.
 */

import type { PrismaClient } from "@prisma/client";
import type { GmailService } from "@/services/integrations/GmailService";
import { GmailLabelService } from "@/services/integrations/GmailLabelService";
import { GmailFilterService } from "@/services/integrations/GmailFilterService";
import type { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import type { OAuth2Client } from "google-auth-library";

/** Only transactions created at/after this date get a smart folder. */
export const SMART_FOLDER_CUTOFF = new Date("2026-01-01T00:00:00Z");

/** Look back this many days when backfilling past threads into the label. */
const BACKFILL_DAYS = 365;
/** Hard cap on threads labeled per backfill to protect from runaway matches. */
const BACKFILL_MAX_THREADS = 200;

export interface SmartFolderResult {
  attempted: boolean;
  configured: boolean;
  reason?: string;
  labelName?: string;
  labelId?: string;
  filterId?: string;
  backfillCount?: number;
}

export interface SmartFolderDeps {
  db: PrismaClient;
  auth: OAuth2Client;
  gmail: GmailService;
  audit: AutomationAuditService;
}

/**
 * Return true if the transaction is eligible for smart-folder setup:
 * created at/after the cutoff AND not already configured.
 */
export function isEligibleForSmartFolder(txn: {
  createdAt: Date;
  smartFolderFilterId: string | null;
}): boolean {
  if (txn.createdAt < SMART_FOLDER_CUTOFF) return false;
  if (txn.smartFolderFilterId) return false;
  return true;
}

function addressLabelSegment(address: string): string {
  // Gmail labels treat "/" as a nesting separator; other chars are OK.
  return address.replace(/\//g, "—").trim().slice(0, 150);
}

function subjectPhrasesFromAddress(addr: string): string[] {
  // Primary: the address up to the comma ("4567 Oak Dr" from "4567 Oak Dr, Nixa MO").
  const parts = addr.split(",");
  const street = parts[0]?.trim();
  const out: string[] = [];
  if (street && street.length >= 4) out.push(street);
  return out;
}

export class SmartFolderService {
  constructor(private readonly deps: SmartFolderDeps) {}

  /**
   * Set up the smart folder for one transaction. Returns a result
   * object; never throws. Safe to call repeatedly — skips if already
   * configured or before the cutoff.
   */
  async setupForTransaction(transactionId: string): Promise<SmartFolderResult> {
    const { db, auth, gmail, audit } = this.deps;
    const txn = await db.transaction.findUnique({
      where: { id: transactionId },
      include: { contact: true },
    });
    if (!txn) return { attempted: false, configured: false, reason: "txn_not_found" };
    if (!isEligibleForSmartFolder(txn)) {
      return {
        attempted: false,
        configured: false,
        reason:
          txn.createdAt < SMART_FOLDER_CUTOFF
            ? "before_cutoff"
            : "already_configured",
      };
    }
    if (!txn.propertyAddress) {
      return {
        attempted: false,
        configured: false,
        reason: "no_property_address",
      };
    }

    const labels = new GmailLabelService(auth, {
      labelPrefix: "REOS/Transactions",
    });
    const filters = new GmailFilterService(auth);

    const labelName = labels.labelNameFor(addressLabelSegment(txn.propertyAddress));
    const result: SmartFolderResult = {
      attempted: true,
      configured: false,
      labelName,
    };

    try {
      // 1. Ensure label
      const labelId = await labels.ensureLabel(labelName);
      result.labelId = labelId;

      // 2. Build participant list + query
      const emails: string[] = [];
      if (txn.contact.primaryEmail) emails.push(txn.contact.primaryEmail);
      const phrases = subjectPhrasesFromAddress(txn.propertyAddress);
      const query = GmailFilterService.buildQuery({ emails, subjectPhrases: phrases });
      if (!query) {
        result.reason = "no_search_criteria";
        return result;
      }

      // 3. Backfill past threads (skip if we already did one and just
      // failed at filter creation previously)
      const priorBackfillDone =
        txn.smartFolderLabelId === labelId &&
        (txn.smartFolderBackfillCount ?? 0) > 0;
      let backfillCount = txn.smartFolderBackfillCount ?? 0;
      if (!priorBackfillDone) {
        const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
        const y = since.getUTCFullYear();
        const m = String(since.getUTCMonth() + 1).padStart(2, "0");
        const d = String(since.getUTCDate()).padStart(2, "0");
        const backfillQuery = `${query} after:${y}/${m}/${d}`;

        backfillCount = 0;
        try {
          const { threads } = await gmail.searchThreadsPaged({
            q: backfillQuery,
            maxTotal: BACKFILL_MAX_THREADS,
          });
          for (const t of threads) {
            if (!t.id) continue;
            try {
              await labels.applyToThread(t.id, labelName);
              backfillCount++;
            } catch (err) {
              console.warn(`smart folder backfill label failed for ${t.id}:`, err);
            }
          }
        } catch (err) {
          console.warn("smart folder backfill search failed:", err);
        }
      }
      result.backfillCount = backfillCount;

      // Persist label + backfill count now, so a re-run doesn't
      // double-work if filter creation fails on insufficient scope.
      await db.transaction.update({
        where: { id: txn.id },
        data: {
          smartFolderLabelId: labelId,
          smartFolderBackfillCount: backfillCount,
        },
      });

      // 4. Create future-matching filter
      const filterId = await filters.createFilter({ query, labelId });
      result.filterId = filterId;

      // 5. Persist full config
      await db.transaction.update({
        where: { id: txn.id },
        data: {
          smartFolderFilterId: filterId,
          smartFolderSetupAt: new Date(),
        },
      });

      // 6. Audit
      await audit.logAction({
        accountId: txn.accountId,
        transactionId: txn.id,
        entityType: "transaction",
        entityId: txn.id,
        ruleName: "smart_folder_setup",
        actionType: "create",
        sourceType: "transaction_event",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: null,
        afterJson: {
          labelName,
          labelId,
          filterId,
          query,
          backfillCount,
        },
      });

      result.configured = true;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.reason = /insufficient\s*permission|insufficient\s*scope/i.test(msg)
        ? "insufficient_scope_reconnect_google"
        : `error: ${msg.slice(0, 200)}`;
      try {
        await audit.logAction({
          accountId: txn.accountId,
          transactionId: txn.id,
          entityType: "transaction",
          entityId: txn.id,
          ruleName: "smart_folder_setup",
          actionType: "create",
          sourceType: "transaction_event",
          confidenceScore: 0,
          decision: "failed",
          beforeJson: null,
          afterJson: { error: msg, labelName },
        });
      } catch {
        // ignore
      }
      return result;
    }
  }
}
