/**
 * TaskTemplates
 *
 * State-aware TC checklists — the work items a transaction coordinator
 * actually needs to DO during a deal (as opposed to Milestones, which
 * track dates). Tasks hang off Milestones where relevant so "open
 * escrow" naturally pairs with the "under contract" milestone.
 *
 * These are deliberately WY-specific with a generic fallback; add
 * state-specific templates as we learn each market's quirks.
 *
 * Each template creates a `Task` row with dueAt=null — unless the
 * template opts in via `relatesToMilestone` + `offsetFromMilestoneDays`,
 * in which case the due date is derived at apply time from the
 * associated milestone's dueAt. The same "newest wins / explicit
 * data only" principle as Milestones — we don't fabricate dates.
 */

import type { PrismaClient } from "@prisma/client";

export interface TaskTemplate {
  /** Short title (< 80 chars). Surfaced in the task list. */
  title: string;
  /** 1-2 sentence detail. Shown when the row is expanded. */
  description?: string;
  /** Owner role this task belongs to (agent, coordinator, client, etc).
   * Coordinators handle most — agent gets the ones requiring negotiation. */
  assignedTo: "coordinator" | "agent" | "client" | "lender" | "title" | "inspector";
  priority: "low" | "normal" | "high" | "urgent";
  /** Optional: link this task to a specific milestone type. When the
   * transaction has that milestone with a dueAt, the task's own dueAt
   * is derived (offsetFromMilestoneDays before the milestone date). */
  relatesToMilestone?: string;
  /** Days before milestone.dueAt to set the task's dueAt. Defaults 0
   * (same day). Only applied if the milestone has a date. */
  offsetFromMilestoneDays?: number;
  /** Include this task only when side matches. Null = both sides. */
  sideFilter?: "buy" | "sell" | "both";
}

/**
 * Universal checklist applied to every transaction regardless of state.
 * Everything here is the core "this deal is real" workflow.
 */
const UNIVERSAL: TaskTemplate[] = [
  {
    title: "Confirm executed contract received",
    description: "Verify every signature page has been signed by all parties.",
    assignedTo: "coordinator",
    priority: "high",
  },
  {
    title: "Open escrow / title order",
    description:
      "Email exec'd contract to the title company; include buyer + seller emails.",
    assignedTo: "coordinator",
    priority: "high",
  },
  {
    title: "Send welcome letter to client",
    description:
      "Set expectations for the next 30 days. Key dates + who to contact.",
    assignedTo: "coordinator",
    priority: "normal",
  },
  {
    title: "Verify earnest money wired",
    description:
      "Confirm title co received EM. Document the receipt for the file.",
    assignedTo: "coordinator",
    priority: "high",
    relatesToMilestone: "earnest_money",
  },
  {
    title: "Coordinate inspection access",
    description:
      "Confirm inspector time w/ seller. Send buyer a what-to-expect note.",
    assignedTo: "coordinator",
    priority: "normal",
    relatesToMilestone: "inspection",
    offsetFromMilestoneDays: 2,
  },
  {
    title: "Send inspection report to buyer's agent",
    description:
      "Forward the report + buyer's objections (if any) before the objection deadline.",
    assignedTo: "coordinator",
    priority: "high",
    relatesToMilestone: "inspection_objection",
    offsetFromMilestoneDays: 1,
  },
  {
    title: "Follow up on title commitment",
    description:
      "Confirm title has issued the commitment. Flag any exceptions for review.",
    assignedTo: "coordinator",
    priority: "normal",
    relatesToMilestone: "title_commitment",
  },
  {
    title: "Verify wire instructions by voice call",
    description:
      "BEFORE buyer sends closing funds, confirm wire details with title by phone. Document the call (compliance).",
    assignedTo: "coordinator",
    priority: "urgent",
    relatesToMilestone: "closing",
    offsetFromMilestoneDays: 3,
  },
  {
    title: "Confirm final walkthrough scheduled",
    description: "Coordinate access with seller's agent.",
    assignedTo: "coordinator",
    priority: "normal",
    relatesToMilestone: "walkthrough",
    offsetFromMilestoneDays: 2,
  },
  {
    title: "Send closing logistics to client",
    description:
      "Where, when, what to bring, who will be there. Plus wire timing.",
    assignedTo: "coordinator",
    priority: "high",
    relatesToMilestone: "closing",
    offsetFromMilestoneDays: 2,
  },
  {
    title: "Request post-closing review",
    description: "7 days after closing — ask for a Zillow/Google review.",
    assignedTo: "coordinator",
    priority: "low",
    relatesToMilestone: "closing",
    offsetFromMilestoneDays: -7, // 7 days AFTER closing (negative = after)
  },
  {
    title: "Submit closed file to broker compliance",
    description:
      "Bundle every required doc, submit via Real Broker portal within 7 days of close.",
    assignedTo: "coordinator",
    priority: "high",
    relatesToMilestone: "closing",
    offsetFromMilestoneDays: -7,
  },
];

/**
 * Buyer-side specific tasks. Focused on lender coordination, HOA
 * docs, loan estimate review.
 */
const BUYER_SIDE: TaskTemplate[] = [
  {
    title: "Forward exec'd contract to lender",
    description: "Lender needs the signed contract within 24h to order appraisal.",
    assignedTo: "coordinator",
    priority: "high",
    sideFilter: "buy",
  },
  {
    title: "Confirm appraisal ordered + scheduled",
    description:
      "Check in with the lender. Get the appraisal date + coordinate access.",
    assignedTo: "coordinator",
    priority: "normal",
    sideFilter: "buy",
  },
  {
    title: "Request + review HOA docs",
    description: "If HOA applies — get CC&Rs + financial docs for buyer review.",
    assignedTo: "coordinator",
    priority: "normal",
    sideFilter: "buy",
  },
  {
    title: "Confirm clear-to-close with lender",
    description:
      "Get the CTC email before closing is confirmed. Verify all conditions cleared.",
    assignedTo: "coordinator",
    priority: "urgent",
    relatesToMilestone: "closing",
    offsetFromMilestoneDays: 3,
    sideFilter: "buy",
  },
];

/**
 * Seller-side specific tasks. Focused on disclosures, showings,
 * net sheet review.
 */
const SELLER_SIDE: TaskTemplate[] = [
  {
    title: "Request seller's property disclosure (if not on file)",
    description:
      "Required doc. Buyer has acceptance deadline to review — deliver early.",
    assignedTo: "coordinator",
    priority: "high",
    sideFilter: "sell",
  },
  {
    title: "Confirm lead-based paint disclosure (pre-1978 homes)",
    description:
      "Required by federal law for any home built before 1978. EPA pamphlet too.",
    assignedTo: "coordinator",
    priority: "high",
    sideFilter: "sell",
  },
  {
    title: "Send seller's estimated net sheet",
    description: "Review numbers with seller once title provides the prelim CD.",
    assignedTo: "coordinator",
    priority: "normal",
    sideFilter: "sell",
  },
  {
    title: "Coordinate utility transfer at closing",
    description:
      "Seller shuts off day-after-close. Buyer needs to schedule transfer.",
    assignedTo: "coordinator",
    priority: "normal",
    relatesToMilestone: "closing",
    offsetFromMilestoneDays: 7,
    sideFilter: "sell",
  },
];

/**
 * Pick the checklist for a given transaction. Filters by side —
 * dual agency gets BOTH buy + sell tasks (representing both
 * parties means doing both jobs).
 */
export function checklistFor(params: {
  side: string | null;
  state: string | null;
}): TaskTemplate[] {
  const side = params.side;
  const out = [...UNIVERSAL];
  if (side === "buy" || side === "both") out.push(...BUYER_SIDE);
  if (side === "sell" || side === "both") out.push(...SELLER_SIDE);
  return out;
}

/**
 * Apply the checklist to a transaction — creates one Task row per
 * template (skipping any that already exist for this txn). Safe to
 * re-run: uses title+transactionId as dedupe key.
 *
 * Derives dueAt from related milestones when possible. Otherwise
 * leaves dueAt null so the task shows up as a date-less checklist
 * item (same pattern as milestones).
 */
export async function applyChecklist(
  db: PrismaClient,
  transactionId: string,
  params: { side: string | null; state: string | null; source?: string },
): Promise<{ created: number; skipped: number }> {
  const [existing, milestones] = await Promise.all([
    db.task.findMany({
      where: { transactionId },
      select: { title: true },
    }),
    db.milestone.findMany({
      where: { transactionId },
      select: { type: true, dueAt: true },
    }),
  ]);
  const have = new Set(existing.map((t) => t.title.toLowerCase()));
  const milestonesByType = new Map(milestones.map((m) => [m.type, m.dueAt]));

  const templates = checklistFor(params);
  let created = 0;
  let skipped = 0;

  for (const t of templates) {
    if (have.has(t.title.toLowerCase())) {
      skipped++;
      continue;
    }
    let dueAt: Date | null = null;
    if (t.relatesToMilestone) {
      const msDue = milestonesByType.get(t.relatesToMilestone);
      if (msDue) {
        const days = t.offsetFromMilestoneDays ?? 0;
        // offset is BEFORE milestone when positive, AFTER when negative
        // (post-close review is offsetFromMilestoneDays: -7 → 7 days after)
        const d = new Date(msDue);
        d.setDate(d.getDate() - days);
        dueAt = d;
      }
    }
    await db.task.create({
      data: {
        transactionId,
        title: t.title,
        description: t.description ?? null,
        dueAt,
        assignedTo: t.assignedTo,
        priority: t.priority,
      },
    });
    created++;
  }
  return { created, skipped };
}
