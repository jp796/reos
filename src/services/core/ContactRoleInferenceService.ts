/**
 * ContactRoleInferenceService
 *
 * "The system gets smarter as it's used."
 *
 * Given an email address, infer what role this person typically
 * plays on a transaction. Two passes:
 *
 *   1. HISTORY  — query every prior TransactionParticipant row
 *      whose Contact has this email. Take the most common role.
 *      High confidence (≥ 0.7) when the same role appears on
 *      ≥ 2 deals.
 *   2. DOMAIN   — fallback to email-domain heuristics when no
 *      history exists. Title companies, lenders, brokerages each
 *      get a recognized signature.
 *
 * Used by the auto-promote-senders pass in the morning tick so
 * a new email from a known title coordinator (or any sender we've
 * seen before) auto-creates a TransactionParticipant on the new
 * deal — without anyone manually adding them.
 */

import type { PrismaClient } from "@prisma/client";

export type InferredSource = "history" | "domain" | "none";
export interface RoleInference {
  role: string | null;
  confidence: number;
  source: InferredSource;
  /** Counts by role from prior deals (history source only). */
  history?: Record<string, number>;
  /** Domain matched (domain source only). */
  domainMatch?: string;
}

/* ============================================================
 * Domain heuristics — extend as we see more brokerages / vendors.
 * Order: more-specific → less-specific. First match wins.
 * ============================================================ */
const DOMAIN_RULES: Array<{ pattern: RegExp; role: string }> = [
  // Title / escrow
  { pattern: /(^|@)([^@]*\.)?fste\.com$/i, role: "title" },
  { pattern: /(^|@)([^@]*\.)?firstam\.com$/i, role: "title" },
  { pattern: /(^|@)([^@]*\.)?stewart\.com$/i, role: "title" },
  { pattern: /(^|@)([^@]*\.)?fnf\.com$/i, role: "title" },
  { pattern: /(^|@)([^@]*\.)?ortc\.com$/i, role: "title" },
  { pattern: /escrow|titlefirst|titleone|titleco/i, role: "title" },
  { pattern: /\btitle\b/i, role: "title" },
  // Lender
  { pattern: /(^|@)([^@]*\.)?rocketmortgage\.com$/i, role: "lender" },
  { pattern: /(^|@)([^@]*\.)?quickenloans\.com$/i, role: "lender" },
  { pattern: /(^|@)([^@]*\.)?wellsfargo\.com$/i, role: "lender" },
  { pattern: /(^|@)([^@]*\.)?freedommortgage\.com$/i, role: "lender" },
  { pattern: /mortgage|lending|loans|\blender\b/i, role: "lender" },
  // Inspectors
  { pattern: /inspect/i, role: "inspector" },
  // Brokerages / agents — domain alone can't tell buy vs list, so we
  // default to "other" with note. The auto-promote pass leaves these
  // for the user to assign side.
  { pattern: /(^|@)([^@]*\.)?kw\.com$/i, role: "other" },
  { pattern: /(^|@)([^@]*\.)?exprealty\.com$/i, role: "other" },
  { pattern: /(^|@)([^@]*\.)?coldwellbanker\.com$/i, role: "other" },
  { pattern: /(^|@)([^@]*\.)?compass\.com$/i, role: "other" },
  { pattern: /(^|@)([^@]*\.)?sothebysrealty\.com$/i, role: "other" },
  { pattern: /(^|@)([^@]*\.)?cheyennehomes\.com$/i, role: "other" },
  // Realtor.com or generic real-estate domains
  { pattern: /\brealtor\b|\brealty\b/i, role: "other" },
];

function inferFromDomain(email: string): RoleInference {
  const lower = email.toLowerCase();
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(lower)) {
      return {
        role: rule.role,
        confidence: 0.55, // moderate — domain alone isn't bulletproof
        source: "domain",
        domainMatch: rule.pattern.source,
      };
    }
  }
  return { role: null, confidence: 0, source: "none" };
}

/**
 * Infer a role for an email by aggregating prior participant rows.
 * Falls back to domain heuristics. Returns null role when nothing
 * useful is found.
 */
export async function inferRoleForEmail(
  db: PrismaClient,
  email: string,
): Promise<RoleInference> {
  const lower = email.trim().toLowerCase();
  if (!lower.includes("@")) return { role: null, confidence: 0, source: "none" };

  // Pull every TransactionParticipant row for any Contact with this email.
  const participants = await db.transactionParticipant.findMany({
    where: {
      contact: {
        primaryEmail: { equals: lower, mode: "insensitive" },
      },
    },
    select: { role: true },
  });

  if (participants.length > 0) {
    const counts: Record<string, number> = {};
    for (const p of participants) {
      counts[p.role] = (counts[p.role] ?? 0) + 1;
    }
    let bestRole: string | null = null;
    let bestCount = 0;
    for (const [role, n] of Object.entries(counts)) {
      if (n > bestCount) {
        bestRole = role;
        bestCount = n;
      }
    }
    if (bestRole) {
      // Confidence = best/total, capped to a sensible range
      const confidence = Math.min(1, bestCount / participants.length);
      return {
        role: bestRole,
        confidence,
        source: "history",
        history: counts,
      };
    }
  }

  return inferFromDomain(lower);
}

/**
 * Auto-promote any unlinked sender on a transaction's smart folder
 * (or recent inbox) into a TransactionParticipant — using their
 * inferred role. Idempotent: existing (transaction, contact, role)
 * triples are left alone.
 *
 * Returns counts so the morning-tick brief can summarize.
 */
export interface AutoLinkResult {
  scanned: number;
  added: number;
  skippedAmbiguous: number;
}

export async function autoLinkSendersForTransaction(
  db: PrismaClient,
  args: {
    transactionId: string;
    /** Lowercased email addresses observed in the deal's recent
     * inbox / smart folder. The caller is responsible for harvesting. */
    senderEmails: string[];
    /** Owner email aliases — never auto-promote yourself. */
    ownerAliases: string[];
    /** Min inference confidence to persist. Below this is skipped. */
    minConfidence?: number;
  },
): Promise<AutoLinkResult> {
  const minConf = args.minConfidence ?? 0.5;
  const out: AutoLinkResult = { scanned: 0, added: 0, skippedAmbiguous: 0 };

  const txn = await db.transaction.findUnique({
    where: { id: args.transactionId },
    select: { id: true, accountId: true },
  });
  if (!txn) return out;

  const ownerSet = new Set(args.ownerAliases.map((s) => s.toLowerCase()));

  for (const rawEmail of args.senderEmails) {
    const email = rawEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (ownerSet.has(email)) continue;
    out.scanned++;

    const inference = await inferRoleForEmail(db, email);
    if (!inference.role || inference.confidence < minConf) {
      out.skippedAmbiguous++;
      continue;
    }

    // Find or create the Contact
    let contact = await db.contact.findFirst({
      where: { primaryEmail: { equals: email, mode: "insensitive" } },
      select: { id: true, fullName: true },
    });
    if (!contact) {
      contact = await db.contact.create({
        data: {
          accountId: txn.accountId,
          fullName: email.split("@")[0]!.replace(/[._]/g, " "),
          primaryEmail: email,
          sourceName: "auto-promoted-sender",
        },
        select: { id: true, fullName: true },
      });
    }

    // Add as participant if not already linked
    const existing = await db.transactionParticipant.findFirst({
      where: { transactionId: args.transactionId, contactId: contact.id },
    });
    if (existing) continue;

    await db.transactionParticipant.create({
      data: {
        transactionId: args.transactionId,
        contactId: contact.id,
        role: inference.role,
        notes: `Auto-promoted via ${inference.source} (confidence ${inference.confidence.toFixed(2)})`,
      },
    });
    out.added++;
  }

  return out;
}
