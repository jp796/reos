/**
 * Creative-finance deadline seeding.
 *
 * A creative deal's timeline is NOT the retail one (no buyer-financing /
 * appraisal / earnest). These are the CF-specific deadlines — seeded as
 * null-date "needs date" milestones (source=creative_template) so the TC
 * sees and fills them. Gated by sub-structure: sub-to / seller-finance
 * carry an underlying-loan + balloon; lease-option carries an option
 * expiration instead of a balloon. Idempotent (deduped by type).
 */

import type { PrismaClient } from "@prisma/client";
import type { CreativeSubstructure } from "./DealClassifierService";

type Db = PrismaClient;

interface CfDeadline {
  type: string;
  label: string;
  ownerRole: string;
  /** When set, only for these sub-structures; otherwise the shared core. */
  subs?: CreativeSubstructure[];
}

const CF_DEADLINES: CfDeadline[] = [
  // Shared core
  { type: "cf_entry_money", label: "Entry money due (down payment / option fee)", ownerRole: "client" },
  { type: "cf_first_payment", label: "First payment due (to servicer / seller)", ownerRole: "client" },
  { type: "cf_insurance_transfer", label: "Insurance transfer effective", ownerRole: "agent" },
  { type: "cf_recording", label: "Record instrument (deed / DOT / memorandum)", ownerRole: "title" },
  // Subject-to
  { type: "cf_existing_loan", label: "Existing-loan verification / estoppel", ownerRole: "agent", subs: ["subject_to", "seller_finance"] },
  { type: "cf_reinstatement", label: "Reinstate arrears (if the loan is behind)", ownerRole: "agent", subs: ["subject_to"] },
  { type: "cf_balloon", label: "Balloon / refinance / exit deadline", ownerRole: "agent", subs: ["subject_to", "seller_finance"] },
  // Lease option
  { type: "cf_option_expiration", label: "Option expiration / exercise deadline", ownerRole: "client", subs: ["lease_option"] },
];

export async function seedCreativeDeadlines(
  db: Db,
  opts: { assetId: string; substructure?: string | null },
): Promise<{ created: number; transactionId: string | null }> {
  const txn = await db.transaction.findFirst({
    where: { assetId: opts.assetId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!txn) return { created: 0, transactionId: null };

  const sub = (opts.substructure ?? null) as CreativeSubstructure | null;
  let created = 0;
  for (const d of CF_DEADLINES) {
    // Sub-structure-gated deadline that doesn't match → skip.
    if (d.subs && (sub == null || !d.subs.includes(sub))) continue;
    const exists = await db.milestone.findFirst({
      where: { transactionId: txn.id, type: d.type },
      select: { id: true },
    });
    if (exists) continue;
    await db.milestone.create({
      data: {
        transactionId: txn.id,
        type: d.type,
        label: `${d.label} — needs date`,
        dueAt: null,
        ownerRole: d.ownerRole,
        source: "creative_template",
        confidenceScore: 0.3,
      },
    });
    created++;
  }
  return { created, transactionId: txn.id };
}
