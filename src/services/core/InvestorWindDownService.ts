/**
 * InvestorWindDownService — when an investor deal goes Pending after the
 * inspection deadline (the buyer's inspection cleared, so the sale is solid),
 * the holding costs should stop. This creates the cancellation checklist so
 * nothing keeps billing on a property that's about to sell.
 *
 * Idempotent via Task.templateKey — safe to fire on every pending transition.
 * These are TASKS (reminders to act), timed for closing, not auto-cancellations
 * (insurance in particular should stay in force until the deed transfers).
 */

import type { PrismaClient } from "@prisma/client";

interface WindDownTask {
  key: string;
  title: string;
  description: string;
  priority: string;
}

const WIND_DOWN_TASKS: WindDownTask[] = [
  {
    key: "winddown_payment",
    title: "Stop the holding payment (mortgage / hard-money / gap loan)",
    description: "Sale is under contract past inspection — line up the payoff so you stop carrying the note.",
    priority: "urgent",
  },
  {
    key: "winddown_utilities",
    title: "Cancel utilities (water / electric / gas)",
    description: "Schedule utility shut-off / transfer effective at closing.",
    priority: "high",
  },
  {
    key: "winddown_insurance",
    title: "Cancel property insurance (effective at closing)",
    description: "Cancel the vacant/builder's-risk policy effective the closing date — keep coverage in force until the deed transfers.",
    priority: "high",
  },
  {
    key: "winddown_recurring",
    title: "Cancel recurring monthly bills (HOA, lawn, security, subscriptions)",
    description: "Stop any auto-pay tied to this property so it doesn't keep billing after the sale.",
    priority: "normal",
  },
];

export interface WindDownResult {
  created: number;
  createdTitles: string[];
}

/**
 * Create the holding-cost cancellation checklist on a deal. Idempotent: a task
 * whose templateKey already exists is skipped, so re-triggering never
 * duplicates. Tasks are due at the closing date when known (else +7 days).
 */
export async function createWindDownChecklist(
  db: PrismaClient,
  transactionId: string,
  opts?: { closingDate?: Date | null },
): Promise<WindDownResult> {
  const existing = await db.task.findMany({
    where: { transactionId, templateKey: { in: WIND_DOWN_TASKS.map((t) => t.key) } },
    select: { templateKey: true },
  });
  const have = new Set(existing.map((e) => e.templateKey));

  const dueAt =
    opts?.closingDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const toCreate = WIND_DOWN_TASKS.filter((t) => !have.has(t.key));
  if (toCreate.length === 0) return { created: 0, createdTitles: [] };

  await db.task.createMany({
    data: toCreate.map((t) => ({
      transactionId,
      templateKey: t.key,
      title: t.title,
      description: t.description,
      priority: t.priority,
      dueAt,
    })),
  });

  return { created: toCreate.length, createdTitles: toCreate.map((t) => t.title) };
}

/**
 * True when a deal qualifies for the wind-down: an investor/wholesale deal
 * that just transitioned to Pending, past its inspection deadline.
 */
export function qualifiesForWindDown(input: {
  newStatus: string;
  prevStatus: string;
  transactionType: string | null;
  representation?: string | null;
  inspectionDate: Date | null;
  inspectionObjectionDate: Date | null;
  now?: Date;
}): boolean {
  if (input.newStatus !== "pending" || input.prevStatus === "pending") return false;
  const isInvestor =
    input.transactionType === "investor" ||
    input.transactionType === "wholesale" ||
    input.representation === "principal";
  if (!isInvestor) return false;
  // "After inspection deadline": the objection/inspection deadline has passed.
  // If no inspection deadline is recorded, we don't auto-fire — canceling
  // holding costs prematurely is worse than a missing checklist.
  const insp = input.inspectionObjectionDate ?? input.inspectionDate;
  if (!insp) return false;
  return insp.getTime() < (input.now?.getTime() ?? Date.now());
}
