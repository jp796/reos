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
  /** Set when enrichment ran (i.e. backfillCount > 0). Shows what
   * the content-scan pulled out of the first batch of labeled
   * threads: new participant rows, fields filled on the transaction. */
  enrichment?: EnrichmentResult;
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

/**
 * Common US street-type abbreviations + their long forms. We generate
 * BOTH variants so "509 Bent Ave" matches whether the email body says
 * "Ave" or "Avenue".
 */
const STREET_TYPE_VARIANTS: Array<[RegExp, string]> = [
  [/\b(ave)\b\.?/gi, "avenue"],
  [/\b(avenue)\b/gi, "ave"],
  [/\b(st)\b\.?/gi, "street"],
  [/\b(street)\b/gi, "st"],
  [/\b(rd)\b\.?/gi, "road"],
  [/\b(road)\b/gi, "rd"],
  [/\b(dr)\b\.?/gi, "drive"],
  [/\b(drive)\b/gi, "dr"],
  [/\b(blvd)\b\.?/gi, "boulevard"],
  [/\b(boulevard)\b/gi, "blvd"],
  [/\b(ln)\b\.?/gi, "lane"],
  [/\b(lane)\b/gi, "ln"],
  [/\b(ct)\b\.?/gi, "court"],
  [/\b(court)\b/gi, "ct"],
  [/\b(hwy)\b\.?/gi, "highway"],
  [/\b(highway)\b/gi, "hwy"],
  [/\b(pkwy)\b\.?/gi, "parkway"],
  [/\b(parkway)\b/gi, "pkwy"],
  [/\b(cir)\b\.?/gi, "circle"],
  [/\b(circle)\b/gi, "cir"],
  [/\b(trl)\b\.?/gi, "trail"],
  [/\b(trail)\b/gi, "trl"],
];

function subjectPhrasesFromAddress(addr: string): string[] {
  // Primary: address up to the comma ("4567 Oak Dr" from "4567 Oak Dr, Nixa MO").
  const parts = addr.split(",");
  let street = parts[0]?.trim() ?? "";
  const out: string[] = [];
  if (!street || street.length < 3) return out;

  // Strip " in <City>" / " in <Town>" phrases that contract-extractor
  // occasionally glues onto the street segment. Example input that
  // this handles: "509 Bent Avenue in Cheyenne, WY 82007" where the
  // extractor put city in the wrong half of the comma split.
  street = street
    .replace(/\s+in\s+[a-z][a-z\s]+$/i, "")
    .replace(/\s+(cheyenne|denver|casper|laramie|gillette|jackson)\s*$/i, "")
    .trim();

  // Always include the full cleaned street
  if (street.length >= 4) out.push(street);

  // Strip TBD / TBD- / Lot #N / Parcel prefixes on new-construction addresses:
  //   "TBD-12107 JK Trail"   → "12107 JK Trail"
  //   "Lot 50 JK Trail"      → "JK Trail"
  //   "Parcel A, Burns Rd"   → "Burns Rd" (main path already handles)
  const stripped = street
    .replace(/^\s*(tbd|parcel|lot|new\s+construction)\s*[#-]?\s*\d*\s*[-\s]*/i, "")
    .trim();
  if (stripped && stripped !== street && stripped.length >= 4) {
    out.push(stripped);
  }

  // Extract the first numeric token (street number) if present — huge
  // win on new-construction where subjects often vary between
  // "TBD 12107 JK Trail", "12107 JK Trail", and "12107 Jk  Trail"
  const numMatch = street.match(/\b(\d{3,6})\b/);
  if (numMatch) {
    const num = numMatch[1];
    // Try: "<num> <rest-after-num>"
    const after = street.slice(street.indexOf(num) + num.length).trim();
    if (after.length >= 3) {
      const numAndName = `${num} ${after}`;
      if (!out.includes(numAndName)) out.push(numAndName);
    }

    // Also: num + first two word tokens after it ("509 Bent Avenue")
    const firstTwo = after.split(/\s+/).slice(0, 2).join(" ");
    if (firstTwo.length >= 3) {
      const short = `${num} ${firstTwo}`;
      if (!out.includes(short)) out.push(short);
    }
  }

  // Generate street-type variants for every phrase we have so far.
  // e.g. "509 Bent Avenue" also emits "509 Bent Ave".
  const variants: string[] = [];
  for (const p of out) {
    for (const [re, replacement] of STREET_TYPE_VARIANTS) {
      if (re.test(p)) {
        const v = p.replace(re, replacement).trim();
        if (v && v !== p && !out.includes(v) && !variants.includes(v)) {
          variants.push(v);
        }
      }
    }
  }
  out.push(...variants);

  // Dedupe + cap length (keep first 6 — more variants = broader match
  // but also more `OR` clauses in the query)
  return [...new Set(out)].slice(0, 6);
}

/**
 * Pull every known email for every party involved in a transaction:
 *   - primary contact (buyer OR seller depending on side)
 *   - all TransactionParticipant rows (co_buyer, co_seller, lender,
 *     title, attorney, inspector, coordinator, other)
 * Filters out the owner's own email (we already send + receive, so
 * searching from:me OR to:me would over-match) and dedupes.
 */
function collectPartyEmails(txn: {
  contact: { primaryEmail: string | null };
  participants: Array<{ contact: { primaryEmail: string | null } }>;
}): string[] {
  const emails = new Set<string>();
  if (txn.contact.primaryEmail) {
    emails.add(txn.contact.primaryEmail.toLowerCase());
  }
  for (const p of txn.participants) {
    const e = p.contact.primaryEmail;
    if (e) emails.add(e.toLowerCase());
  }
  return [...emails].filter((e) => e.includes("@"));
}

/** Result of the post-label content-enrichment step. */
export interface EnrichmentResult {
  threadsScanned: number;
  newParticipantsCreated: number;
  titleCompanyFilled: boolean;
  lenderFilled: boolean;
  primaryEmailFilled: boolean;
}

/** Regex heuristics for title co / lender identity in email addresses
 * and subject lines. Deliberately broad — we only WRITE when the
 * corresponding field is null on the transaction. */
const TITLE_CO_HINTS = /(title|escrow|flying\s*s|qualia|fidelity|first\s+am|chicago\s+title|stewart\s+title|old\s+republic|cornerstone\s+title|landsafe|settlement)/i;
const LENDER_HINTS = /(mortgage|lending|home\s*loans|financial|bank|lender|loan|credit\s*union|first\s*national|wells\s*fargo|chase|quicken|rocket)/i;

export class SmartFolderService {
  constructor(private readonly deps: SmartFolderDeps) {}

  /**
   * Force a re-backfill: scan Gmail with CURRENT address phrases +
   * contact emails, apply the label to any matching threads. Use this
   * when a folder was created early (minimal data) and missed
   * threads because the address was "TBD-xxx" or the contact didn't
   * have an email yet. Idempotent — Gmail label application is safe
   * to re-run on threads already labeled.
   */
  async rebackfill(transactionId: string): Promise<{
    ok: boolean;
    reason?: string;
    labelName?: string;
    newlyLabeled?: number;
    query?: string;
    enrichment?: EnrichmentResult;
  }> {
    const { db, auth, gmail } = this.deps;
    const txn = await db.transaction.findUnique({
      where: { id: transactionId },
      include: {
        contact: true,
        participants: { include: { contact: true } },
      },
    });
    if (!txn) return { ok: false, reason: "txn_not_found" };
    if (!txn.propertyAddress) {
      return { ok: false, reason: "no_property_address" };
    }

    const labels = new GmailLabelService(auth, {
      labelPrefix: "REOS/Transactions",
    });
    const labelName = labels.labelNameFor(
      addressLabelSegment(txn.propertyAddress),
    );
    const labelId = await labels.ensureLabel(labelName);

    const emails = collectPartyEmails(txn);
    const phrases = subjectPhrasesFromAddress(txn.propertyAddress);
    const query = GmailFilterService.buildQuery({
      emails,
      subjectPhrases: phrases,
    });
    if (!query) return { ok: false, reason: "no_search_criteria", labelName };

    const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
    const y = since.getUTCFullYear();
    const m = String(since.getUTCMonth() + 1).padStart(2, "0");
    const d = String(since.getUTCDate()).padStart(2, "0");
    const backfillQuery = `${query} after:${y}/${m}/${d}`;

    let newlyLabeled = 0;
    try {
      const { threads } = await gmail.searchThreadsPaged({
        q: backfillQuery,
        maxTotal: BACKFILL_MAX_THREADS,
      });
      for (const t of threads) {
        if (!t.id) continue;
        try {
          await labels.applyToThread(t.id, labelName);
          newlyLabeled++;
        } catch (err) {
          console.warn(`rebackfill label failed for ${t.id}:`, err);
        }
      }
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        labelName,
        query: backfillQuery,
      };
    }

    await db.transaction.update({
      where: { id: txn.id },
      data: {
        smartFolderLabelId: labelId,
        smartFolderBackfillCount: Math.max(
          txn.smartFolderBackfillCount ?? 0,
          newlyLabeled,
        ),
      },
    });

    // Content enrichment — read the labeled threads, pull out party
    // emails / title co / lender hints, and fold them back into the
    // transaction. Non-blocking: a failure here shouldn't erase the
    // backfill we just completed.
    let enrichment: EnrichmentResult | undefined;
    if (newlyLabeled > 0) {
      try {
        enrichment = await this.enrichFromLabel(transactionId, labelId);
      } catch (err) {
        console.warn("[SmartFolder] enrichment failed (non-blocking):", err);
      }
    }

    return {
      ok: true,
      labelName,
      newlyLabeled,
      query: backfillQuery,
      enrichment,
    };
  }

  /**
   * Read the top N recently labeled threads for this transaction and
   * pull out party information:
   *   - every non-owner email address seen in From/To/Cc headers →
   *     upsert as TransactionParticipant(role="other") if we don't
   *     already have a contact with that email
   *   - if primary contact has no email and we can identify one from
   *     the headers, fill it in
   *   - if title company name is empty and a sender domain matches
   *     TITLE_CO_HINTS, guess the title co name from the domain
   *   - same for lender
   *
   * Idempotent. Only WRITES when the target field is empty.
   */
  private async enrichFromLabel(
    transactionId: string,
    labelId: string,
  ): Promise<EnrichmentResult> {
    const { db, gmail } = this.deps;
    const txn = await db.transaction.findUnique({
      where: { id: transactionId },
      include: {
        contact: true,
        participants: { include: { contact: true } },
      },
    });
    if (!txn) {
      return {
        threadsScanned: 0,
        newParticipantsCreated: 0,
        titleCompanyFilled: false,
        lenderFilled: false,
        primaryEmailFilled: false,
      };
    }

    const ownerEmail = (
      process.env.AUTH_ALLOWED_EMAILS ?? ""
    )
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const existingEmails = new Set(collectPartyEmails(txn));

    // Pull the latest ~20 labeled threads (enough signal, cheap enough)
    const { threads } = await gmail.searchThreads({
      labelIds: [labelId],
      maxResults: 20,
    });

    // Extract party identities from headers
    interface Party {
      email: string;
      name: string | null;
      domain: string;
      seenIn: Set<"from" | "to" | "cc">;
    }
    const parties = new Map<string, Party>();
    const addFromHeader = (
      raw: string | undefined,
      where: "from" | "to" | "cc",
    ) => {
      if (!raw) return;
      // Split on comma — headers can have multiple addresses
      for (const piece of raw.split(",")) {
        const m = piece.match(/(?:"?([^"<]+?)"?\s*)?<?([^\s<>]+@[^\s<>]+)>?/);
        if (!m) continue;
        const name = (m[1] ?? "").trim() || null;
        const email = m[2].trim().toLowerCase();
        if (!email.includes("@")) continue;
        if (ownerEmail.includes(email)) continue;
        const domain = email.split("@")[1];
        const cur = parties.get(email) ?? {
          email,
          name,
          domain,
          seenIn: new Set(),
        };
        if (name && !cur.name) cur.name = name;
        cur.seenIn.add(where);
        parties.set(email, cur);
      }
    };

    for (const thread of threads) {
      for (const msg of thread.messages ?? []) {
        const headers = msg.payload?.headers ?? [];
        const h = (n: string): string | undefined =>
          headers.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ??
          undefined;
        addFromHeader(h("From"), "from");
        addFromHeader(h("To"), "to");
        addFromHeader(h("Cc"), "cc");
      }
    }

    // Upsert new parties as TransactionParticipant rows
    let newParticipantsCreated = 0;
    let titleCompanyFilled = false;
    let lenderFilled = false;
    let primaryEmailFilled = false;

    // If primary contact has no email and we have exactly one
    // sender matching by name, attach that email to them.
    if (!txn.contact.primaryEmail) {
      const byName = [...parties.values()].find(
        (p) =>
          p.name &&
          txn.contact.fullName &&
          p.name.toLowerCase().includes(
            txn.contact.fullName.toLowerCase(),
          ),
      );
      if (byName) {
        await db.contact.update({
          where: { id: txn.contactId },
          data: { primaryEmail: byName.email },
        });
        existingEmails.add(byName.email);
        primaryEmailFilled = true;
      }
    }

    for (const party of parties.values()) {
      if (existingEmails.has(party.email)) continue;

      // Determine a role based on heuristics
      let role = "other";
      if (TITLE_CO_HINTS.test(party.email) || TITLE_CO_HINTS.test(party.name ?? "")) {
        role = "title";
      } else if (
        LENDER_HINTS.test(party.email) ||
        LENDER_HINTS.test(party.name ?? "")
      ) {
        role = "lender";
      }

      // Upsert the contact
      let contact = await db.contact.findFirst({
        where: {
          accountId: txn.accountId,
          primaryEmail: { equals: party.email, mode: "insensitive" },
        },
      });
      if (!contact) {
        contact = await db.contact.create({
          data: {
            accountId: txn.accountId,
            fullName: party.name ?? party.email,
            primaryEmail: party.email,
            sourceName: "SmartFolder enrichment",
          },
        });
      }
      // Upsert the participant link (ignore uniqueness collision)
      try {
        await db.transactionParticipant.create({
          data: {
            transactionId: txn.id,
            contactId: contact.id,
            role,
            notes: `Auto-added from SmartFolder enrichment (seen in ${[...party.seenIn].join("/")})`,
          },
        });
        newParticipantsCreated++;
      } catch {
        // unique violation — already linked
      }

      // Fill transaction-level fields (only if null)
      if (!txn.titleCompanyName && role === "title") {
        await db.transaction.update({
          where: { id: txn.id },
          data: {
            titleCompanyName: (party.name ?? party.domain).slice(0, 120),
          },
        });
        titleCompanyFilled = true;
      }
      if (!txn.lenderName && role === "lender") {
        await db.transaction.update({
          where: { id: txn.id },
          data: {
            lenderName: (party.name ?? party.domain).slice(0, 120),
          },
        });
        lenderFilled = true;
      }
    }

    return {
      threadsScanned: threads.length,
      newParticipantsCreated,
      titleCompanyFilled,
      lenderFilled,
      primaryEmailFilled,
    };
  }

  /**
   * Set up the smart folder for one transaction. Returns a result
   * object; never throws. Safe to call repeatedly — skips if already
   * configured or before the cutoff.
   */
  async setupForTransaction(transactionId: string): Promise<SmartFolderResult> {
    const { db, auth, gmail, audit } = this.deps;
    const txn = await db.transaction.findUnique({
      where: { id: transactionId },
      include: {
        contact: true,
        participants: { include: { contact: true } },
      },
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

      // 2. Build participant list + query. Pulls emails from primary
      // contact AND any TransactionParticipant rows (co_buyer / co_seller
      // / title / lender / inspector etc.) so new threads from the
      // other agent, title co, and lender all land in this folder.
      const emails = collectPartyEmails(txn);
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

      // Enrichment step — read labeled threads and auto-fill
      // participants / title co / lender / primary-contact email.
      // Non-blocking on failure.
      if (backfillCount > 0) {
        try {
          const enrichment = await this.enrichFromLabel(txn.id, labelId);
          (result as SmartFolderResult & { enrichment: EnrichmentResult }).enrichment =
            enrichment;
        } catch (err) {
          console.warn(
            "[SmartFolder] post-create enrichment failed (non-blocking):",
            err instanceof Error ? err.message : err,
          );
        }
      }

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
