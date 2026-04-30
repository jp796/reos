/**
 * PostCloseAutomation
 *
 * Fires work items after a transaction closes. No surprises, no
 * hidden emails — every rule creates a Task (not an auto-send) so
 * the TC reviews before anything goes to the client.
 *
 * Rules live in code for now (simple to reason about, audit-trailable,
 * no DB config surface to maintain). Each rule:
 *   - Fires N calendar days AFTER the closing milestone (or after
 *     closingDate if the milestone isn't present)
 *   - Creates one Task per firing with a dueAt equal to
 *     closingDate + daysAfter, a clear title, and a description
 *     pointing the TC to the right email template if applicable
 *   - Gets audit-logged so a re-tick never double-fires
 *
 * Wire this into a daily Cloud Scheduler job once deployed. For now,
 * manually hit POST /api/automation/post-close/tick (also exposed as
 * a button on /today for on-demand sweeps).
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

export interface PostCloseRule {
  /** Unique id for audit-log de-dupe. Also the task title prefix. */
  id: string;
  /** Human-readable what-it-does. */
  label: string;
  /** How many days after closingDate to fire. Negative = days BEFORE
   * closing, for pre-close prep tasks (not used yet but supported). */
  daysAfter: number;
  /** Task title shown to the TC. {{client_name}} resolves at fire time. */
  taskTitle: string;
  /** Task description with context / instructions. */
  taskDescription: string;
  /** Template category to suggest — surfaced in the task description. */
  suggestedTemplateCategory?: string;
  /** Priority on the created Task. */
  priority: "low" | "normal" | "high" | "urgent";
}

export const POST_CLOSE_RULES: PostCloseRule[] = [
  {
    id: "post_close_review_request",
    label: "Ask for a review",
    daysAfter: 7,
    taskTitle: "Send review request to {{client_name}}",
    taskDescription:
      "7 days post-close. Send the Post-close review request template (Google + Zillow). Most business comes from referrals — this is the highest-ROI task of the month.",
    suggestedTemplateCategory: "post_close",
    priority: "normal",
  },
  {
    id: "post_close_send_gift",
    label: "Closing gift reminder",
    daysAfter: 14,
    taskTitle: "Order closing gift for {{client_name}}",
    taskDescription:
      "14 days post-close. Order or drop off the closing gift if not already done. Typically a restaurant gift card + handwritten note for primary-residence buyers/sellers; something local for out-of-state clients.",
    priority: "normal",
  },
  {
    id: "post_close_nps",
    label: "NPS survey check-in",
    daysAfter: 30,
    taskTitle: "30-day check-in + NPS with {{client_name}}",
    taskDescription:
      "30 days post-close. Quick email asking 'How's everything so far? Anything I can help with?' Low-pressure relationship touch that separates agents who stay top-of-mind from those who vanish.",
    priority: "low",
  },
  {
    id: "post_close_compliance_file",
    label: "Submit compliance file",
    daysAfter: 1,
    taskTitle: "Submit closed file to Real Broker compliance",
    taskDescription:
      "1 day post-close. Bundle every required doc (use the Compliance panel to confirm coverage) and upload via Real Broker portal. Commission release is gated on this.",
    priority: "high",
  },
  {
    id: "post_close_six_month",
    label: "6-month check-in",
    daysAfter: 180,
    taskTitle: "6-month check-in with {{client_name}}",
    taskDescription:
      "Half-year post-close. Light touch — settle in update, neighborhood news, anything they need. Bring up the home as a financial asset (equity built, market change). Most agents skip this; that's why it's worth doing.",
    suggestedTemplateCategory: "post_close",
    priority: "low",
  },
  {
    id: "post_close_anniversary",
    label: "Home anniversary",
    daysAfter: 365,
    taskTitle: "1-year anniversary with {{client_name}}",
    taskDescription:
      "1 year since closing. Send the home-anniversary email — congratulate them, reference the property, invite referrals. Good time for a CMA-as-gift if you want to spark a future move.",
    suggestedTemplateCategory: "post_close",
    priority: "normal",
  },
];

function mergeClientName(str: string, clientName: string): string {
  return str.replace(/\{\{client_name\}\}/g, clientName);
}

/**
 * Run post-close automation against every eligible transaction. A
 * transaction is eligible if:
 *   - status = "closed"
 *   - closingDate is set
 *   - For each rule, (now - closingDate) >= daysAfter
 *   - The rule hasn't already fired for this txn (tracked via
 *     automation_audit_logs rule_name = POST_CLOSE_RULE.id)
 *
 * Idempotent. Safe to run hourly.
 */
export async function tickPostClose(db: PrismaClient): Promise<{
  scanned: number;
  tasksCreated: number;
  rulesFired: Record<string, number>;
}> {
  const now = new Date();
  const closedTxns = await db.transaction.findMany({
    where: {
      status: "closed",
      closingDate: { not: null, lte: now },
    },
    include: { contact: true },
  });

  let tasksCreated = 0;
  const rulesFired: Record<string, number> = {};

  // Per-account toggle so brokerages whose own software runs the file
  // audit (Rezen, Skyslope, etc.) don't get a duplicate REOS task.
  const accountSettingsCache = new Map<string, boolean>();
  async function complianceAuditEnabledFor(accountId: string): Promise<boolean> {
    const cached = accountSettingsCache.get(accountId);
    if (cached !== undefined) return cached;
    const a = await db.account.findUnique({
      where: { id: accountId },
      select: { settingsJson: true },
    });
    const s = (a?.settingsJson ?? {}) as Record<string, unknown>;
    const enabled = s.complianceAuditEnabled !== false;
    accountSettingsCache.set(accountId, enabled);
    return enabled;
  }

  for (const txn of closedTxns) {
    if (!txn.closingDate) continue;
    const daysSinceClose = Math.floor(
      (now.getTime() - txn.closingDate.getTime()) / 86_400_000,
    );

    for (const rule of POST_CLOSE_RULES) {
      if (daysSinceClose < rule.daysAfter) continue;
      if (
        rule.id === "post_close_compliance_file" &&
        !(await complianceAuditEnabledFor(txn.accountId))
      )
        continue;

      // De-dupe via audit log: did we already fire this rule for this txn?
      const prior = await db.automationAuditLog.findFirst({
        where: {
          accountId: txn.accountId,
          transactionId: txn.id,
          ruleName: rule.id,
        },
      });
      if (prior) continue;

      // Fire: create the task + stamp the audit log
      const fireDue = new Date(txn.closingDate);
      fireDue.setDate(fireDue.getDate() + rule.daysAfter);

      await db.task.create({
        data: {
          transactionId: txn.id,
          title: mergeClientName(rule.taskTitle, txn.contact.fullName).slice(0, 200),
          description: [
            mergeClientName(rule.taskDescription, txn.contact.fullName),
            rule.suggestedTemplateCategory
              ? `\n\nTemplate category to use: ${rule.suggestedTemplateCategory}`
              : "",
          ]
            .join("")
            .slice(0, 1000),
          dueAt: fireDue,
          assignedTo: "coordinator",
          priority: rule.priority,
        },
      });
      tasksCreated++;
      rulesFired[rule.id] = (rulesFired[rule.id] ?? 0) + 1;

      await db.automationAuditLog.create({
        data: {
          accountId: txn.accountId,
          transactionId: txn.id,
          entityType: "task",
          entityId: null,
          ruleName: rule.id,
          actionType: "create",
          sourceType: "automation",
          confidenceScore: 1.0,
          decision: "applied",
          beforeJson: Prisma.JsonNull,
          afterJson: {
            ruleLabel: rule.label,
            daysAfter: rule.daysAfter,
            firedAt: now.toISOString(),
          },
        },
      });
    }
  }

  return {
    scanned: closedTxns.length,
    tasksCreated,
    rulesFired,
  };
}
