/**
 * GmailDocIngestService — marries EVERY relevant attachment on a deal's email
 * threads to the transaction as a Document, not just the one contract, and
 * enriches the deal's structured co-op-agent / title-company fields from the
 * senders.
 *
 * The old flow only pulled the newest contract PDF from the SmartFolder and
 * dropped everything else — title commitments, disclosures, addenda, closing
 * docs from the title company and the other agent.
 *
 * Attach precision (a wrong doc on a deal is worse than a missing one): a
 * document auto-attaches ONLY when the deal's address is in the message OR the
 * user filed the thread into the deal's folder. A sender-email-only match no
 * longer attaches — title companies / co-agents work many deals, so their
 * emails about other properties must not dump the wrong docs here. Real
 * documents only (pdf/docx; images are signature junk), deduped on
 * Document.sourceRef AND on (deal, filename). Sender-only messages still
 * enrich the deal's title/co-op fields.
 */

import type { PrismaClient } from "@prisma/client";
import type { gmail_v1 } from "googleapis";
import type { GmailService } from "@/services/integrations/GmailService";
import { detectTitleCompanyEmail } from "@/services/ai/TitleCompanyDetector";
import {
  scoreEmailAgainstDeal,
  decideAttach,
  splitDealEmails,
  PRINCIPAL_PARTICIPANT_ROLES,
} from "@/services/automation/DealEmailMatcher";
import { enrichFlatDealContacts } from "@/services/core/DealContactEnrichmentService";

const ACTIVE_DEAL_STATUSES = ["active", "listing", "pending"] as const;

/**
 * Map every buyer/seller PRINCIPAL email in the account to the set of active
 * deals they're a principal on. Used at attach time to decide whether a
 * principal sender is unambiguous: if their email maps to exactly one active
 * deal, their attachments safely auto-attach to it; if to several, we can't
 * tell which property a given email means, so we flag rather than guess.
 *
 * Case-insensitive (keys are lowercased) so a differently-cased duplicate on
 * another deal can't slip past the exclusivity check and cause a mis-attach.
 */
async function activePrincipalDealIndex(
  db: PrismaClient,
  accountId: string,
): Promise<Map<string, Set<string>>> {
  const index = new Map<string, Set<string>>();
  const add = (email: string | null | undefined, txnId: string) => {
    const e = email?.trim().toLowerCase();
    if (!e) return;
    if (!index.has(e)) index.set(e, new Set());
    index.get(e)!.add(txnId);
  };

  // Primary contact = the deal's principal (buyer or seller by side).
  const primaries = await db.transaction.findMany({
    where: { accountId, status: { in: [...ACTIVE_DEAL_STATUSES] } },
    select: { id: true, contact: { select: { primaryEmail: true } } },
  });
  for (const t of primaries) add(t.contact?.primaryEmail, t.id);

  // co_buyer / co_seller participants are principals too.
  const parts = await db.transactionParticipant.findMany({
    where: {
      role: { in: [...PRINCIPAL_PARTICIPANT_ROLES] },
      transaction: { accountId, status: { in: [...ACTIVE_DEAL_STATUSES] } },
    },
    select: { transactionId: true, contact: { select: { primaryEmail: true } } },
  });
  for (const p of parts) add(p.contact?.primaryEmail, p.transactionId);

  return index;
}

const MAX_THREADS = 40;
const MAX_ATTACH = 60;
// Real transaction documents only. Images (png/jpg/tiff) are almost always
// email-signature logos/inline graphics, never contract docs — ingesting them
// is what buried deals under 100+ "icon.png"/"logo.jpeg" junk files.
const DOC_EXT = /\.(pdf|docx?)$/i;

export interface IngestResult {
  scannedThreads: number;
  attached: number;
  skippedExisting: number;
  fieldsEnriched: number;
  /** Attachments from a buyer/seller who is on more than one active deal —
   *  not auto-attached (we can't tell which deal), surfaced for manual review. */
  flaggedForReview: number;
}

const ZERO: IngestResult = {
  scannedThreads: 0,
  attached: 0,
  skippedExisting: 0,
  fieldsEnriched: 0,
  flaggedForReview: 0,
};

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** Pull "Name <email>" → { name, email }. */
function parseFrom(from: string): { name: string | null; email: string | null } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]?.trim() || null, email: m[2]?.trim().toLowerCase() || null };
  const bare = from.trim().toLowerCase();
  return { name: null, email: /@/.test(bare) ? bare : null };
}

function categoryFor(filename: string): string {
  const f = filename.toLowerCase();
  if (/(purchase|contract|offer|psa|rpa)/.test(f)) return "contract";
  if (/(title|commitment|prelim)/.test(f)) return "title";
  if (/(inspect)/.test(f)) return "inspection";
  if (/(apprais)/.test(f)) return "appraisal";
  if (/(addend|amend|counter)/.test(f)) return "addendum";
  if (/(disclos|spd|lead)/.test(f)) return "disclosure";
  if (/(closing|settlement|\bcd\b|alta|hud)/.test(f)) return "closing";
  return "other";
}

/**
 * Ingest every attachment on a deal's threads. Best-effort: individual
 * download/create failures are swallowed so one bad message never aborts the run.
 */
export async function ingestDealDocs(
  db: PrismaClient,
  gmail: GmailService,
  accountId: string,
  transactionId: string,
): Promise<IngestResult> {
  const txn = await db.transaction.findFirst({
    where: { id: transactionId, accountId },
    select: {
      id: true,
      propertyAddress: true,
      smartFolderLabelId: true,
      coAgentEmail: true,
      titleCompanyEmail: true,
      titleCompanyName: true,
      contact: { select: { fullName: true, primaryEmail: true } },
      participants: {
        select: { role: true, contact: { select: { fullName: true, primaryEmail: true } } },
      },
    },
  });
  if (!txn) return { ...ZERO };

  // Split this deal's contacts into principals (buyer/seller — deal-specific,
  // safe to attach when exclusive) vs vendors (title/co-agent/lender — shared,
  // enrich-only). Both feed the Gmail search; the attach gate treats them
  // differently.
  const candidate = splitDealEmails(txn);
  const searchEmails = [...candidate.principalEmails, ...candidate.vendorEmails];

  // Which of this deal's principal senders are tied to exactly ONE active deal
  // (this one)? Only those are safe to auto-attach on the sender alone.
  const principalIndex = await activePrincipalDealIndex(db, accountId);
  const isExclusivePrincipal = (email: string | null): boolean => {
    const e = email?.trim().toLowerCase();
    return !!e && principalIndex.get(e)?.size === 1;
  };
  // Flag each ambiguous principal sender for review at most once per run.
  const flaggedSenders = new Set<string>();

  // Build the search: the deal's own folder + a known-sender / address query.
  const street = txn.propertyAddress?.split(",")[0]?.trim() ?? null;
  const senderClause = searchEmails.slice(0, 10).map((e) => `from:${e}`).join(" OR ");
  const orParts = [senderClause, street && street.length >= 4 ? `"${street}"` : null].filter(Boolean);
  const q = `has:attachment newer_than:180d${orParts.length ? ` (${orParts.join(" OR ")})` : ""}`;

  const threadSets: gmail_v1.Schema$Thread[] = [];
  // Threads the user actually filed into the deal's REOS folder are trusted:
  // foldering is an explicit "this belongs to this deal" signal, so their
  // attachments may auto-attach even without an address in the body.
  const foldered = new Set<string>();
  try {
    const { threads } = await gmail.searchThreadsPaged({ q, maxTotal: MAX_THREADS });
    threadSets.push(...threads);
  } catch {
    /* query failed — fall back to label-only below */
  }
  if (txn.smartFolderLabelId) {
    try {
      const { threads } = await gmail.searchThreadsPaged({
        q: "has:attachment",
        labelIds: [txn.smartFolderLabelId],
        maxTotal: MAX_THREADS,
      });
      for (const t of threads) if (t.id) foldered.add(t.id);
      threadSets.push(...threads);
    } catch {
      /* ignore */
    }
  }

  const result: IngestResult = { ...ZERO };
  const seenThreads = new Set<string>();
  const enrich: { titleCompanyEmail?: string | null; titleCompanyName?: string | null; titleCompanyContact?: string | null } = {};

  for (const thread of threadSets) {
    if (!thread.id || seenThreads.has(thread.id)) continue;
    seenThreads.add(thread.id);
    if (result.attached >= MAX_ATTACH) break;
    result.scannedThreads++;

    const messages = thread.messages ?? [];
    for (const msg of messages) {
      if (!msg.id || result.attached >= MAX_ATTACH) continue;
      const from = parseFrom(header(msg, "from"));
      const subject = header(msg, "subject");
      const snippet = msg.snippet ?? "";

      // Confirm the message really belongs to THIS deal (a broad from:/address
      // query can catch strays).
      const match = scoreEmailAgainstDeal(
        { fromEmail: from.email, subject, bodyText: snippet },
        candidate,
      );
      if (!match) continue;

      // ATTACH gate (see decideAttach): auto-attach when the deal's ADDRESS is
      // in the message, OR the thread is filed in the deal's folder, OR the
      // sender is a buyer/seller PRINCIPAL who is tied to exactly one active
      // deal. A shared vendor (title/co-agent/lender) never attaches on the
      // sender alone — that was the over-attach bug. A principal on several
      // active deals is ambiguous: flagged for review, not guessed.
      const folderedThread = thread.id ? foldered.has(thread.id) : false;
      const { attach: trustedForAttach, flagAmbiguous } = decideAttach(match, {
        foldered: folderedThread,
        senderExclusivePrincipal: isExclusivePrincipal(from.email),
      });

      // Title-company enrichment from the sender.
      if (from.email && !txn.titleCompanyEmail && !enrich.titleCompanyEmail) {
        const det = detectTitleCompanyEmail({
          fromEmail: from.email,
          fromName: from.name,
          subject,
          bodyText: snippet,
        });
        if (det.isTitleCompany) {
          enrich.titleCompanyEmail = from.email;
          if (!txn.titleCompanyName && from.name) enrich.titleCompanyName = from.name;
          if (from.name) enrich.titleCompanyContact = from.name;
        }
      }

      if (!trustedForAttach) {
        // Ambiguous principal (same buyer/seller on multiple active deals): we
        // can't tell which property this email is about. Record it once so the
        // user can attach it manually, and move on — never guess.
        if (flagAmbiguous && from.email && !flaggedSenders.has(from.email)) {
          flaggedSenders.add(from.email);
          const dealIds = [...(principalIndex.get(from.email.toLowerCase()) ?? [])];
          try {
            await db.automationAuditLog.create({
              data: {
                accountId,
                transactionId: txn.id,
                entityType: "transaction",
                entityId: txn.id,
                ruleName: "gmail_ingest_ambiguous_principal",
                actionType: "suggest",
                sourceType: "email_analysis",
                confidenceScore: match.confidence,
                decision: "suggested",
                afterJson: {
                  reason:
                    "sender is a buyer/seller on multiple active deals — attachment not auto-attached, review manually",
                  fromEmail: from.email,
                  subject,
                  candidateDealIds: dealIds,
                },
              },
            });
            result.flaggedForReview++;
          } catch {
            /* audit log is best-effort — never block ingest on it */
          }
        }
        // Sender-only / vendor / party-name matches still enriched fields above.
        continue;
      }

      let atts;
      try {
        atts = await gmail.getMessageAttachments(msg.id);
      } catch {
        continue;
      }
      for (const a of atts) {
        if (result.attached >= MAX_ATTACH) break;
        if (!DOC_EXT.test(a.filename)) continue;
        const sourceRef = `gmail:${msg.id}:${a.attachmentId}`;

        const existing = await db.document.findUnique({ where: { sourceRef }, select: { id: true } });
        if (existing) {
          result.skippedExisting++;
          continue;
        }
        // Same file, already on this deal from another message (an offer PDF
        // re-sent across replies/forwards) — attach it once, not per message.
        const dupName = await db.document.findFirst({
          where: { transactionId: txn.id, fileName: a.filename },
          select: { id: true },
        });
        if (dupName) {
          result.skippedExisting++;
          continue;
        }
        try {
          const buf = await gmail.downloadAttachment(msg.id, a.attachmentId);
          await db.document.create({
            data: {
              transactionId: txn.id,
              category: categoryFor(a.filename),
              fileName: a.filename,
              mimeType: a.mimeType || "application/pdf",
              rawBytes: buf,
              source: "gmail_attachment",
              sourceRef,
              uploadOrigin: `ingest:${match.signal}`,
              uploadedAt: new Date(),
              sourceDate: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
            },
          });
          result.attached++;
        } catch {
          /* skip this attachment, keep going */
        }
      }
    }
  }

  if (Object.keys(enrich).length > 0) {
    result.fieldsEnriched = await enrichFlatDealContacts(db, txn.id, {
      agents: [],
      titleCompanyName: enrich.titleCompanyName ?? null,
      titleCompanyContact: enrich.titleCompanyContact ?? null,
      titleCompanyEmail: enrich.titleCompanyEmail ?? null,
    });
  }

  // Buy-side deals rarely name the listing agent in the contract — AI-read the
  // other agent from their email signature when the co-op agent is still blank.
  try {
    const { captureCoAgentFromEmails } = await import("./CoAgentEmailCapture");
    const co = await captureCoAgentFromEmails(db, gmail, accountId, txn.id);
    if (co) result.fieldsEnriched++;
  } catch {
    /* best-effort — never block ingest on the co-agent capture */
  }

  return result;
}
