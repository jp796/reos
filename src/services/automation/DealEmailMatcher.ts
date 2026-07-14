/**
 * DealEmailMatcher — decide which transaction an inbound email belongs to,
 * even when the subject line has no clean address (title companies and the
 * other agent almost never include one).
 *
 * Signal priority (strongest first):
 *   1. sender email == a known contact ON a deal (co-op agent, title company,
 *      lender, or any participant). This is what rescues title-co / co-op mail.
 *   2. property address (street # + zip) found in the subject/body.
 *   3. a party name (buyer/seller/agent) found in the body.
 *
 * The address/name scoring is pure + unit-tested; the DB lookup wires them to
 * real deals.
 */

import type { PrismaClient } from "@prisma/client";

export type MatchSignal = "sender_email" | "address" | "party_name";

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
  knownEmails: string[]; // co-op agent, title co, lender, participants, primary contact
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
  if (from && deal.knownEmails.map(normEmail).includes(from)) {
    return {
      transactionId: deal.id,
      signal: "sender_email",
      confidence: 0.97,
      reason: `sender ${from} is a known contact on this deal`,
    };
  }

  const text = `${email.subject ?? ""}\n${email.bodyText ?? ""}`;
  if (addressMatches(deal.propertyAddress, text)) {
    return {
      transactionId: deal.id,
      signal: "address",
      confidence: 0.85,
      reason: `property address matched in the email`,
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
        select: { contact: { select: { fullName: true, primaryEmail: true } } },
      },
    },
  });

  const candidates: DealCandidate[] = deals.map((d) => {
    const emails = [
      d.coAgentEmail,
      d.titleCompanyEmail,
      d.contact?.primaryEmail ?? null,
      ...d.participants.map((p) => p.contact?.primaryEmail ?? null),
    ].filter((e): e is string => !!e);
    const names = [
      d.contact?.fullName ?? null,
      ...d.participants.map((p) => p.contact?.fullName ?? null),
    ].filter((n): n is string => !!n);
    return { id: d.id, propertyAddress: d.propertyAddress, knownEmails: emails, partyNames: names };
  });

  return bestMatch(email, candidates);
}
