/**
 * AcceptedContractScanService
 *
 * Finds purchase contracts in Gmail that are FULLY EXECUTED (both
 * buyer + seller signed) AND have a future closing date, AND don't
 * yet correspond to a Transaction in our DB.
 *
 * Surfaces candidates for the user to either:
 *   • Attach to an existing txn (rare; usually we're finding deals
 *     that haven't been tracked at all)
 *   • Create a new transaction using the extracted data
 *
 * Conservative: runs the ContractExtraction pipeline on each PDF
 * so we're only flagging real executed contracts, not drafts.
 */

import type { PrismaClient } from "@prisma/client";
import type { GmailService } from "@/services/integrations/GmailService";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";

const CONTRACT_FILENAME_RES: RegExp[] = [
  /purchase[_\s-]*(?:agreement|contract)/i,
  /contract[_\s-]*to[_\s-]*(?:buy|sell)/i,
  /residential.*(?:sale|purchase).*contract/i,
  /offer.*purchase/i,
  /binding.*agreement/i,
  /executed.*contract/i,
  /signed.*contract/i,
  /\bcontract\b.*\.pdf$/i,
  /\bagreement\b.*\.pdf$/i,
  // new-construction builder contracts often use "builder agreement"
  /builder.*(?:agreement|contract)/i,
  /new[_\s-]*construction.*contract/i,
];

const MAX_THREADS_PER_RUN = 120;
// Cap extractions so one run fits in a single HTTP timeout window.
// Each contract extraction is ~15-30s (text + optional Vision fallback).
// 12 × 25s ≈ 5min — a pragmatic ceiling. For a full-history sweep, call
// the endpoint multiple times with narrowing `days` windows.
const MAX_EXTRACTS_PER_RUN = 12;

export interface AcceptedContractHit {
  threadId: string;
  subject: string;
  from: string;
  date: string | null;
  filename: string;
  messageId: string;
  attachmentId: string;
  propertyAddress: string | null;
  /** True when the address starts with "TBD" / "Lot #" / similar —
   *  common on new-construction deals before the final address lands. */
  isNewConstruction: boolean;
  buyers: string[];
  sellers: string[];
  purchasePrice: number | null;
  closingDate: string | null;
  effectiveDate: string | null;
  contractStage: string | null;
  titleCompany: string | null;
  matchedTransactionId: string | null;
  matchedContactId: string | null;
  matchedContactName: string | null;
  /** 0..1 confidence that this is really the user's deal. Combines
   *  signals: stage=executed, future closing, price extracted, title
   *  company present, buyer/seller matches a known contact, etc. */
  confidence: number;
  /** Human-readable breakdown of confidence contributors (audit) */
  signals: string[];
  gmailUrl: string;
}

export interface AcceptedContractScanResult {
  scanned: number;
  extracted: number;
  hits: AcceptedContractHit[];
  skippedNoExec: number;
  skippedNoFutureClose: number;
  errored: number;
}

export class AcceptedContractScanService {
  constructor(
    private readonly db: PrismaClient,
    private readonly gmail: GmailService,
    private readonly extractor: ContractExtractionService,
  ) {}

  async scan(
    options: { days?: number; trustedSenders?: string[] } = {},
  ): Promise<AcceptedContractScanResult> {
    const days = Math.min(Math.max(options.days ?? 90, 7), 365);
    const out: AcceptedContractScanResult = {
      scanned: 0,
      extracted: 0,
      hits: [],
      skippedNoExec: 0,
      skippedNoFutureClose: 0,
      errored: 0,
    };

    // Trusted-sender union — if the user has flagged outside TCs in
    // Settings → Brokerage, ANY thread from those senders with an
    // attachment counts as a contract candidate (TCs sometimes send
    // the executed contract without the keywords we usually match).
    const senderClause = (options.trustedSenders ?? [])
      .map((s) => `from:"${s.replace(/"/g, "")}"`)
      .join(" OR ");
    const keywordClause =
      `(contract OR "purchase agreement" OR "offer to purchase" OR "binding agreement")`;
    const matchClause = senderClause
      ? `(${keywordClause} OR ${senderClause})`
      : keywordClause;
    const q = `newer_than:${days}d has:attachment ${matchClause}`;
    const { threads } = await this.gmail.searchThreadsPaged({
      q,
      maxTotal: MAX_THREADS_PER_RUN,
    });

    const now = new Date();
    let extracts = 0;
    const seenAttachments = new Set<string>();

    // Lowercased allowlist for fast `from`-header matching
    const trustedLower = (options.trustedSenders ?? []).map((s) =>
      s.trim().toLowerCase(),
    );
    const fromMatchesTrusted = (fromHeader: string): boolean => {
      const f = (fromHeader ?? "").toLowerCase();
      if (!f) return false;
      for (const entry of trustedLower) {
        if (!entry) continue;
        // bare/leading-@ domain → match anything ending in that domain
        if (entry.startsWith("@")) {
          if (f.includes(entry)) return true;
          continue;
        }
        if (entry.includes("@")) {
          if (f.includes(entry)) return true;
        } else if (f.includes("@" + entry)) {
          return true;
        }
      }
      return false;
    };

    for (const t of threads) {
      if (extracts >= MAX_EXTRACTS_PER_RUN) break;
      out.scanned++;
      if (!t.messages?.length) continue;

      // Pre-scan: is any message in this thread from a trusted TC?
      // When yes we widen our attachment filter so a contract named
      // "Smith_2026.pdf" still gets extracted.
      let threadFromTrusted = false;
      if (trustedLower.length > 0) {
        for (const m of t.messages) {
          const fromH =
            m.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")
              ?.value ?? "";
          if (fromMatchesTrusted(fromH)) {
            threadFromTrusted = true;
            break;
          }
        }
      }

      // Find the newest contract-ish PDF in the thread
      let found: {
        messageId: string;
        attachmentId: string;
        filename: string;
        subject: string;
        from: string;
        date: string | null;
      } | null = null;

      for (const m of t.messages) {
        if (!m.id) continue;
        try {
          const atts = await this.gmail.getMessageAttachments(m.id);
          for (const a of atts) {
            if (!/\.pdf$/i.test(a.filename)) continue;
            // Trusted TC sender? Any PDF qualifies. Otherwise require the
            // filename to look contract-y so we don't burn extractions on
            // random invoices / commission disclosures.
            if (
              !threadFromTrusted &&
              !CONTRACT_FILENAME_RES.some((re) => re.test(a.filename))
            )
              continue;
            const dedupKey = `${m.id}:${a.attachmentId}`;
            if (seenAttachments.has(dedupKey)) continue;
            seenAttachments.add(dedupKey);
            const subject =
              m.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")
                ?.value ?? "";
            const from =
              m.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")
                ?.value ?? "";
            const date =
              m.payload?.headers?.find((h) => h.name?.toLowerCase() === "date")
                ?.value ?? null;
            found = {
              messageId: m.id,
              attachmentId: a.attachmentId,
              filename: a.filename,
              subject,
              from,
              date,
            };
            break;
          }
        } catch {
          // skip
        }
        if (found) break;
      }
      if (!found) continue;
      if (extracts >= MAX_EXTRACTS_PER_RUN) break;

      // Extract the contract
      let buf: Buffer;
      try {
        buf = await this.gmail.downloadAttachment(
          found.messageId,
          found.attachmentId,
        );
      } catch {
        out.errored++;
        continue;
      }

      let ex;
      try {
        ex = await this.extractor.extract(buf);
        extracts++;
        out.extracted++;
      } catch (err) {
        console.warn(
          `contract-scan extract failed for ${t.id}:`,
          err instanceof Error ? err.message : err,
        );
        out.errored++;
        continue;
      }

      // CONFIDENCE-BASED FILTERING
      // Instead of gating on stage===executed alone, score each hit
      // from multiple signals and keep anything >= 0.4. The UI asks
      // the user to confirm mid-confidence hits.
      const stage = ex.contractStage?.value ?? null;
      const closingIso = ex.closingDate?.value;
      const closing = closingIso ? new Date(closingIso) : null;

      const propertyAddress = ex.propertyAddress?.value ?? null;
      const isNewConstruction = !!(
        propertyAddress &&
        /^(tbd|lot\s*#?\s*\d+|parcel|new\s+construction)/i.test(
          propertyAddress.trim(),
        )
      );

      // Known-contact matching
      let matchedTransactionId: string | null = null;
      let matchedContactId: string | null = null;
      let matchedContactName: string | null = null;

      if (propertyAddress && !isNewConstruction) {
        const street = propertyAddress.split(",")[0]?.trim();
        if (street && street.length >= 4) {
          const match = await this.db.transaction.findFirst({
            where: {
              propertyAddress: { contains: street, mode: "insensitive" },
            },
            select: { id: true, contactId: true, contact: { select: { fullName: true } } },
          });
          if (match) {
            matchedTransactionId = match.id;
            matchedContactId = match.contactId;
            matchedContactName = match.contact.fullName;
          }
        }
      }
      if (!matchedContactId) {
        const names = [
          ...(ex.buyers?.value ?? []),
          ...(ex.sellers?.value ?? []),
        ];
        for (const n of names) {
          if (typeof n !== "string" || n.length < 4) continue;
          const contact = await this.db.contact.findFirst({
            where: { fullName: { contains: n, mode: "insensitive" } },
            select: { id: true, fullName: true },
          });
          if (contact) {
            matchedContactId = contact.id;
            matchedContactName = contact.fullName;
            break;
          }
        }
      }

      // ──────────────────────────────────────────
      // CONFIDENCE ASSEMBLY
      // ──────────────────────────────────────────
      const signals: string[] = [];
      let score = 0;

      // (1) Contract stage
      if (stage === "executed") {
        score += 0.3;
        signals.push("fully-executed (+0.30)");
      } else if (stage === "counter") {
        score += 0.15;
        signals.push("counter (+0.15)");
      } else if (stage === "offer") {
        score += 0.05;
        signals.push("offer only (+0.05)");
      }

      // (2) Future closing
      if (closing && closing > now) {
        score += 0.2;
        signals.push("future closing (+0.20)");
      } else if (!closing) {
        signals.push("no closing date extracted");
      } else {
        signals.push("closing already past");
      }

      // (3) Financial details
      if (ex.purchasePrice?.value) {
        score += 0.1;
        signals.push(`price $${ex.purchasePrice.value} (+0.10)`);
      }
      if (ex.titleCompanyName?.value) {
        score += 0.1;
        signals.push(`title co: ${ex.titleCompanyName.value} (+0.10)`);
      }

      // (4) Contact match — strongest "yours" signal
      if (matchedContactId) {
        score += 0.2;
        signals.push(`matched contact: ${matchedContactName} (+0.20)`);
      } else if ((ex.buyers?.value?.length ?? 0) + (ex.sellers?.value?.length ?? 0) > 0) {
        score += 0.03;
        signals.push("parties extracted, no REOS contact match (+0.03)");
      }

      // (5) Email-to-party cross-reference: if the extracted buyer
      // or seller name shows up in the from/to of ANY message in
      // this thread, that's evidence the contract is legitimately
      // tied to the parties (not a blast template).
      const allNames = [
        ...(ex.buyers?.value ?? []),
        ...(ex.sellers?.value ?? []),
      ].map((s) => (typeof s === "string" ? s.toLowerCase() : ""));
      let nameInHeaders = false;
      if (allNames.length > 0 && t.messages) {
        for (const m of t.messages) {
          const hdrs = (m.payload?.headers ?? [])
            .filter((h) =>
              /^(from|to|cc|bcc)$/i.test(h.name ?? ""),
            )
            .map((h) => (h.value ?? "").toLowerCase())
            .join(" ");
          if (allNames.some((n) => n && n.length > 4 && hdrs.includes(n))) {
            nameInHeaders = true;
            break;
          }
        }
      }
      if (nameInHeaders) {
        score += 0.15;
        signals.push("party name matches email headers (+0.15)");
      }

      // (6) INVESTOR / WHOLESALER LEAD PENALTY
      // Unsolicited cash-offer / assignment contracts from wholesalers
      // look like purchase agreements but aren't Jp's actual deals.
      // Detect via sender-domain blocklist + subject patterns.
      const from = (found.from ?? "").toLowerCase();
      const subjLower = (found.subject ?? "").toLowerCase();
      const WHOLESALER_DOMAIN_RES = [
        /cashoffer/i,
        /we[-_\s]?buy[-_\s]?houses/i,
        /homevestors/i,
        /opendoor/i,
        /offerpad/i,
        /iwillbuyhouse/i,
        /investor/i,
        /wholesal/i,
      ];
      const INVESTOR_SUBJECT_RES = [
        /cash\s+offer/i,
        /investor\s+offer/i,
        /assignment\s+(?:of\s+)?contract/i,
        /wholesal/i,
      ];
      if (
        WHOLESALER_DOMAIN_RES.some((r) => r.test(from)) ||
        INVESTOR_SUBJECT_RES.some((r) => r.test(subjLower))
      ) {
        score -= 0.35;
        signals.push("looks like wholesaler/investor lead (-0.35)");
      }

      // (7) Buyer is LLC AND no REOS-contact match → downgrade
      // (classic pattern of an unsolicited cash offer to a listing)
      const buyerIsEntity = (ex.buyers?.value ?? []).some(
        (n) => typeof n === "string" && /\b(LLC|INC|LP|TRUST|LTD)\b/i.test(n),
      );
      if (buyerIsEntity && !matchedContactId) {
        score -= 0.15;
        signals.push("buyer is LLC + no contact match (-0.15)");
      }

      if (isNewConstruction) signals.push("new-construction (TBD/Lot)");
      if (matchedTransactionId) signals.push("already tracked in REOS");

      // (8) Trusted TC sender — strong evidence the deal is real.
      // Vouches for the source even when REOS doesn't yet have the
      // contact (the whole point: pulling NEW deals from outside TCs).
      const fromTrusted = fromMatchesTrusted(found.from);
      if (fromTrusted) {
        score += 0.25;
        signals.push("trusted TC sender (+0.25)");
      }

      score = Math.max(0, Math.min(1, score));

      // ──────────────────────────────────────────
      // GATING
      // Higher bar for deals with no contact match — those are the
      // common false-positive surface (blast offers, adjacent deals).
      // Trusted TC senders pre-vouch for the deal so we lower the bar
      // and accept "stage unknown" + price/closing as evidence.
      // ──────────────────────────────────────────
      const minScore = fromTrusted ? 0.35 : matchedContactId ? 0.4 : 0.55;
      const hasEvidence =
        stage === "executed" ||
        fromTrusted ||
        (ex.purchasePrice?.value && (closing || matchedContactId));
      if (!hasEvidence || score < minScore) {
        if (stage !== "executed") out.skippedNoExec++;
        else out.skippedNoFutureClose++;
        continue;
      }

      out.hits.push({
        threadId: t.id ?? "",
        subject: found.subject.slice(0, 160),
        from: found.from.slice(0, 160),
        date: found.date,
        filename: found.filename,
        messageId: found.messageId,
        attachmentId: found.attachmentId,
        propertyAddress,
        isNewConstruction,
        buyers: (ex.buyers?.value ?? []).slice(0, 4),
        sellers: (ex.sellers?.value ?? []).slice(0, 4),
        purchasePrice: ex.purchasePrice?.value ?? null,
        closingDate: closingIso ?? null,
        effectiveDate: ex.effectiveDate?.value ?? null,
        contractStage: stage,
        titleCompany: ex.titleCompanyName?.value ?? null,
        matchedTransactionId,
        matchedContactId,
        matchedContactName,
        confidence: score,
        signals,
        gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${t.id ?? ""}`,
      });
    }

    return out;
  }
}
