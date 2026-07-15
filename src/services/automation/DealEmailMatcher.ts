/**
 * DealEmailMatcher — decide which transaction an inbound email belongs to,
 * even when the subject line has no clean address (title companies, the other
 * agent, AND a deal's own seller/buyer almost never restate it).
 *
 * Sender emails are split by ROLE, because the two behave very differently:
 *   - PRINCIPAL (this deal's buyer/seller — the primary contact or a
 *     co_buyer/co_seller). A principal is deal-specific: Wendy the seller
 *     emails about HER house. Their mail is a strong, safe attach signal —
 *     as long as that person is tied to exactly ONE active deal (the
 *     attach-time exclusivity check in GmailDocIngestService enforces that).
 *   - VENDOR (co-op agent, title company, lender, inspector, attorney…).
 *     A vendor works MANY deals at once, so sender-alone can't tell which
 *     property a given email is about. Vendor mail enriches fields and can
 *     attach only when corroborated by the address or the deal's folder —
 *     never on the sender alone (this is what caba512 fixed).
 *
 * Signal priority (strongest first):
 *   1. sender is a PRINCIPAL of this deal            → sender_principal
 *   2. property address (street # + zip) in the text → address
 *   3. sender is a VENDOR on this deal               → sender_vendor
 *   4. a party name found in the body                → party_name
 *
 * The address/name scoring is pure + unit-tested; the DB lookup wires them to
 * real deals. The attach decision itself is `decideAttach` below.
 */

import type { PrismaClient } from "@prisma/client";

export type MatchSignal =
  | "sender_principal"
  | "sender_vendor"
  | "address"
  | "party_name";

export interface DealMatch {
  transactionId: string;
  signal: MatchSignal;
  confidence: number; // 0..1
  reason: string;
}

/** Street number (first 1–6 digit run) + a 5-digit zip — tolerant of
 *  "Street/St", "Wyoming/WY", punctuation, word order. */
export function addrKey(s: string): { streetNum: string | null; zip: string | null } {
  const nums = s.match(/\d{1,6}/g) ?? [];
  const zip = nums.find((n) => n.length === 5) ?? null;
  const streetNum = nums.find((n) => n !== zip) ?? nums[0] ?? null;
  return { streetNum: streetNum ?? null, zip };
}

const normEmail = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** True when the deal's address is present in the email text (street # + zip
 *  when the deal has a zip; street # alone otherwise). */
export function addressMatches(dealAddress: string | null, emailText: string): boolean {
  if (!dealAddress) return false;
  const deal = addrKey(dealAddress);
  if (!deal.streetNum) return false;
  const nums = new Set(emailText.match(/\d{1,6}/g) ?? []);
  if (!nums.has(deal.streetNum)) return false;
  if (deal.zip) return nums.has(deal.zip);
  return true;
}

/** A candidate deal, reduced to the fields matching needs. */
export interface DealCandidate {
  id: string;
  propertyAddress: string | null;
  /** This deal's buyer/seller principals: the primary contact plus any
   *  co_buyer/co_seller. Deal-specific → strong attach signal. */
  principalEmails: string[];
  /** Shared vendors on this deal: co-op agent, title co, lender, inspector,
   *  attorney. Work many deals → enrich/corroborate only, never attach alone. */
  vendorEmails: string[];
  partyNames: string[]; // buyer/seller/contact names
}

export interface InboundEmail {
  fromEmail: string | null;
  subject: string | null;
  bodyText: string | null;
}

/** Pure scorer: best signal for one email vs one deal, or null. */
export function scoreEmailAgainstDeal(email: InboundEmail, deal: DealCandidate): DealMatch | null {
  const from = normEmail(email.fromEmail);

  // 1. Sender is a PRINCIPAL of this deal (their own buyer/seller). Strongest,
  //    and deal-specific — the attach gate additionally requires this person be
  //    tied to exactly one active deal before it trusts it to auto-attach.
  if (from && deal.principalEmails.map(normEmail).includes(from)) {
    return {
      transactionId: deal.id,
      signal: "sender_principal",
      confidence: 0.95,
      reason: `sender ${from} is a buyer/seller principal on this deal`,
    };
  }

  const text = `${email.subject ?? ""}\n${email.bodyText ?? ""}`;

  // 2. Property address in the text — deal-specific regardless of who sent it.
  if (addressMatches(deal.propertyAddress, text)) {
    return {
      transactionId: deal.id,
      signal: "address",
      confidence: 0.85,
      reason: `property address matched in the email`,
    };
  }

  // 3. Sender is a VENDOR on this deal (title co / co-agent / lender…). Useful
  //    for routing + field enrichment, but NOT enough to attach on its own:
  //    the same vendor sends mail about many other properties.
  if (from && deal.vendorEmails.map(normEmail).includes(from)) {
    return {
      transactionId: deal.id,
      signal: "sender_vendor",
      confidence: 0.7,
      reason: `sender ${from} is a vendor (title/co-agent/lender) on this deal`,
    };
  }

  const lower = text.toLowerCase();
  for (const name of deal.partyNames) {
    const n = name.trim().toLowerCase();
    if (n.length >= 5 && lower.includes(n)) {
      return {
        transactionId: deal.id,
        signal: "party_name",
        confidence: 0.6,
        reason: `party "${name}" named in the email`,
      };
    }
  }
  return null;
}

/**
 * The attach decision, factored out so it is pure and unit-testable.
 *
 * A document auto-attaches to a deal ONLY when we're confident the email is
 * about THAT property:
 *   - the address is in the email, OR the user filed the thread into the deal's
 *     folder (explicit "belongs here" signals), OR
 *   - the sender is a buyer/seller principal of the deal AND that person is
 *     tied to exactly one active deal (so there's no other deal it could mean).
 *
 * A principal who is on MORE than one active deal is ambiguous — we do not
 * guess; the caller flags it for manual review. Vendor senders and bare
 * party-name matches never attach on their own.
 */
export function decideAttach(
  match: Pick<DealMatch, "signal">,
  ctx: { foldered: boolean; senderExclusivePrincipal: boolean },
): { attach: boolean; flagAmbiguous: boolean } {
  if (match.signal === "address" || ctx.foldered) {
    return { attach: true, flagAmbiguous: false };
  }
  if (match.signal === "sender_principal") {
    return ctx.senderExclusivePrincipal
      ? { attach: true, flagAmbiguous: false }
      : { attach: false, flagAmbiguous: true };
  }
  return { attach: false, flagAmbiguous: false };
}

/** Rank all candidates for an email; highest-confidence match wins. */
export function bestMatch(email: InboundEmail, deals: DealCandidate[]): DealMatch | null {
  let best: DealMatch | null = null;
  for (const d of deals) {
    const m = scoreEmailAgainstDeal(email, d);
    if (m && (!best || m.confidence > best.confidence)) best = m;
  }
  return best;
}

/**
 * Load this account's open deals as match candidates and return the best match
 * for the email. Only "active/listing/pending" deals are considered so a closed
 * deal's old contacts don't hijack new mail.
 */
export async function matchEmailToDeal(
  db: PrismaClient,
  accountId: string,
  email: InboundEmail,
): Promise<DealMatch | null> {
  const deals = await db.transaction.findMany({
    where: { accountId, isDemo: false, status: { in: ["active", "listing", "pending"] } },
    select: {
      id: true,
      propertyAddress: true,
      coAgentEmail: true,
      titleCompanyEmail: true,
      lenderName: true,
      contact: { select: { fullName: true, primaryEmail: true } },
      participants: {
        select: { role: true, contact: { select: { fullName: true, primaryEmail: true } } },
      },
    },
  });

  const candidates: DealCandidate[] = deals.map((d) => splitDealEmails(d));

  return bestMatch(email, candidates);
}

/** Roles that make a participant a buyer/seller PRINCIPAL of the deal (as
 *  opposed to a shared vendor). The deal's primary contact is always a
 *  principal too. Keep in sync with TransactionParticipant.role values. */
export const PRINCIPAL_PARTICIPANT_ROLES = new Set(["co_buyer", "co_seller"]);

/**
 * Split a deal's contacts into principal vs vendor email sets and party names.
 * Shared by matchEmailToDeal and the Gmail ingest so both classify identically.
 */
export function splitDealEmails(d: {
  id: string;
  propertyAddress: string | null;
  coAgentEmail: string | null;
  titleCompanyEmail: string | null;
  contact: { fullName: string | null; primaryEmail: string | null } | null;
  participants: {
    role: string;
    contact: { fullName: string | null; primaryEmail: string | null } | null;
  }[];
}): DealCandidate {
  const principalEmails = [
    d.contact?.primaryEmail ?? null,
    ...d.participants
      .filter((p) => PRINCIPAL_PARTICIPANT_ROLES.has(p.role))
      .map((p) => p.contact?.primaryEmail ?? null),
  ].filter((e): e is string => !!e);

  const vendorEmails = [
    d.coAgentEmail,
    d.titleCompanyEmail,
    ...d.participants
      .filter((p) => !PRINCIPAL_PARTICIPANT_ROLES.has(p.role))
      .map((p) => p.contact?.primaryEmail ?? null),
  ].filter((e): e is string => !!e);

  const partyNames = [
    d.contact?.fullName ?? null,
    ...d.participants.map((p) => p.contact?.fullName ?? null),
  ].filter((n): n is string => !!n);

  return { id: d.id, propertyAddress: d.propertyAddress, principalEmails, vendorEmails, partyNames };
}
