/**
 * ExtractionLearningService (Layer 2 — Atlas gets smarter as it's used).
 *
 * The loop:
 *   capture   → recordCorrection(): a human fixed a field Atlas extracted.
 *   generalize→ when the SAME (state, docType, field) correction recurs to a
 *               threshold, it's promoted to an ACTIVE rule with injectable
 *               guidance.
 *   inject    → getActiveRules(): the extraction prompt pulls ONLY the rules
 *               relevant to THIS document's state + docType. A few hundred
 *               tokens of the right guidance — never re-training, never the
 *               raw correction log.
 *
 * Token-efficient by construction: corrections are captured for free (the
 * human is already correcting), rules are injected only when relevant, and
 * nothing here calls a model.
 */

import type { PrismaClient } from "@prisma/client";

/** Corrections need this many supporting signals before they inject a rule. */
export const PROMOTE_THRESHOLD = 2;

/** Fields whose corrections generalize into useful extraction guidance.
 *  Unique-per-deal values (address, zip, names) are intentionally excluded —
 *  a rule about one address teaches nothing. */
const LEARNABLE_FIELDS = new Set([
  "sellers",
  "buyers",
  "side",
  "closingDate",
  "inspectionDeadline",
  "inspectionObjectionDeadline",
  "financingDeadline",
  "earnestMoneyAmount",
  "purchasePrice",
  "listing_agent",
  "buyers_agent",
  "titleCompany",
]);

export function isLearnableField(field: string): boolean {
  return LEARNABLE_FIELDS.has(field);
}

const clip = (s: string | null | undefined, n = 80) => (s ? s.slice(0, n) : null);

/**
 * Record a single correction. Idempotent per (account, state, docType, field):
 * repeated corrections bump `weight`; crossing PROMOTE_THRESHOLD flips the row
 * to an active injectable rule. Never stores document content — only the
 * field + short normalized samples. Never throws into the caller.
 */
export async function recordCorrection(
  db: PrismaClient,
  input: {
    accountId: string;
    state: string | null;
    docType?: string;
    field: string;
    extracted?: string | null;
    corrected?: string | null;
  },
): Promise<void> {
  try {
    if (!isLearnableField(input.field)) return;
    const docType = input.docType || "purchase_contract";
    const state = input.state?.trim().toUpperCase() || null;

    const existing = await db.extractionLearning.findFirst({
      where: { accountId: input.accountId, state, docType, field: input.field },
    });

    if (existing) {
      const weight = existing.weight + 1;
      const active = weight >= PROMOTE_THRESHOLD;
      await db.extractionLearning.update({
        where: { id: existing.id },
        data: {
          weight,
          active,
          kind: active ? "rule" : existing.kind,
          ruleText: active ? existing.ruleText ?? ruleTextFor(input.field, state) : existing.ruleText,
          extracted: existing.extracted ?? clip(input.extracted),
          corrected: clip(input.corrected) ?? existing.corrected,
        },
      });
      return;
    }

    await db.extractionLearning.create({
      data: {
        accountId: input.accountId,
        state,
        docType,
        field: input.field,
        kind: "correction",
        extracted: clip(input.extracted),
        corrected: clip(input.corrected),
        weight: 1,
        active: false,
      },
    });
  } catch {
    /* learning must never break the workflow */
  }
}

/**
 * Active injectable rules for a document, most-supported first. Returns the
 * short guidance strings to prepend to the extraction prompt.
 */
export async function getActiveRules(
  db: PrismaClient,
  opts: { accountId: string; state: string | null; docType?: string; anyState?: boolean },
): Promise<string[]> {
  try {
    const state = opts.state?.trim().toUpperCase() || null;
    const docType = opts.docType || "purchase_contract";
    const rows = await db.extractionLearning.findMany({
      where: {
        accountId: opts.accountId,
        active: true,
        docType,
        // state-specific rules for THIS state + state-agnostic rules; or, when
        // the state isn't known yet (initial upload), every active rule.
        ...(opts.anyState ? {} : { OR: [{ state }, { state: null }] }),
      },
      orderBy: { weight: "desc" },
      take: 20,
    });
    return rows
      .map((r) => r.ruleText ?? ruleTextFor(r.field, r.state))
      .filter((s): s is string => !!s);
  } catch {
    return [];
  }
}

/** Render active rules as a compact block for the extraction system prompt. */
export function rulesPromptBlock(rules: string[]): string {
  if (rules.length === 0) return "";
  return [
    "",
    "LEARNED CORRECTIONS (from this account's past fixes — follow these exactly):",
    ...rules.map((r) => `- ${r}`),
  ].join("\n");
}

/** The generalized guidance for a field. Kept as templated text so a promoted
 *  rule reads like a human instruction, not a data row. */
export function ruleTextFor(field: string, state: string | null): string {
  const where = state ? `${state} ` : "";
  switch (field) {
    case "sellers":
      return `On ${where}contracts, extract EVERY seller — co-owners (e.g. spouses) are common and both appear on the signature/notary page. Never drop the second seller.`;
    case "buyers":
      return `On ${where}contracts, extract EVERY buyer — co-buyers are common. Never drop the second buyer.`;
    case "side":
      return `On ${where}contracts, determine representation from the drafting/footer agent (the "Prepared by" agent represents the buyer). Do not guess the side from which name appears first.`;
    case "listing_agent":
    case "buyers_agent":
      return `On ${where}contracts, capture BOTH sides' agents (name, email, phone, brokerage) from the signature/broker block — do not relabel the buyer's agent as the listing agent to fill a gap.`;
    case "inspectionObjectionDeadline":
      return `On ${where}contracts, compute the inspection-objection deadline from the contract's stated rule (often N days from mutual acceptance), not from the inspection date.`;
    case "closingDate":
      return `On ${where}contracts, read the closing date from the stated "on or before" clause; if amended by an addendum, the newest date wins.`;
    case "earnestMoneyAmount":
      return `On ${where}contracts, capture the earnest-money amount even when it sits on a separate line or rider from the price.`;
    default:
      return `On ${where}contracts, double-check the "${field}" field — it has been corrected before on this account.`;
  }
}
