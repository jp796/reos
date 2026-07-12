/**
 * Today decision-queue assignment (remediation §11 closure).
 *
 * The Today page used to render the same underlying transaction problem in
 * several sections at once — a deal with an overdue deadline showed in
 * "Prevent harm" AND the scored "At risk" list AND, if it was also silent,
 * "Waiting on others". That makes the page a report, not a decision queue.
 *
 * This function assigns each ACTIVE transaction to exactly ONE primary
 * queue — the highest-precedence one it qualifies for — so a single
 * incident never appears twice. Precedence:
 *
 *     Prevent harm  >  Do today  >  Waiting on others  >  informational At-risk
 *
 * It also splits post-close nurture into its own lane (never an active
 * risk) and keeps "Prevent harm" scarce at one incident per deal.
 *
 * Closed transactions never reach here — the caller queries `status:
 * "active"` — so a closed deal contributes nothing to any queue.
 *
 * Pure + accessor-driven so the page can pass its real Prisma rows and the
 * behavior is unit-testable without a database.
 */

import { classifyMilestone, isPostCloseNurture } from "./risk";

export interface TodayQueueInput<M, T, S, R> {
  /** Every overdue milestone on an active deal (unfiltered). */
  overdueMilestones: M[];
  /** Every overdue task on an active deal (unfiltered — post-close split here). */
  overdueTasks: T[];
  /** Deals with 7+ days of communication silence. */
  silentDeals: S[];
  /** Deals the risk engine scored above threshold (for the informational lane). */
  scoredRisky: R[];
  accessors: {
    milestoneTxn: (m: M) => string;
    milestoneType: (m: M) => string;
    milestoneLabel: (m: M) => string;
    taskTxn: (t: T) => string;
    taskTitle: (t: T) => string;
    silentTxn: (s: S) => string;
    scoredTxn: (r: R) => string;
  };
}

export interface TodayQueues<M, T, S, R> {
  /** Critical contractual / closing / compliance deadlines, one per deal. */
  harm: M[];
  /** Overdue TC tasks whose deal isn't already in `harm`. */
  doToday: T[];
  /** Post-close nurture tasks — separate lane, never active risk. */
  postClose: T[];
  /** Silent deals not already surfaced in a higher queue. */
  waiting: S[];
  /** Scored-risky deals not surfaced anywhere above (informational only). */
  atRisk: R[];
}

/**
 * Deal-prioritized rollup for the secondary "Other overdue milestones" list
 * (REOS_04). A deal already in Prevent harm must not reappear elsewhere, so we
 * exclude by DEAL id (not milestone id) and report how many OTHER overdue
 * milestones each harm deal has — rendered as "+N additional issues" inside the
 * primary harm item. Pure + accessor-driven so the page and tests share it.
 */
export function overdueDealRollup<M>(
  harmMilestones: M[],
  overdueMilestones: M[],
  txnId: (m: M) => string,
): { other: M[]; extraIssuesFor: (m: M) => number } {
  const counts = new Map<string, number>();
  for (const m of overdueMilestones) {
    counts.set(txnId(m), (counts.get(txnId(m)) ?? 0) + 1);
  }
  const harmDeals = new Set(harmMilestones.map(txnId));
  const other = overdueMilestones.filter((m) => !harmDeals.has(txnId(m)));
  const extraIssuesFor = (m: M) => (counts.get(txnId(m)) ?? 1) - 1;
  return { other, extraIssuesFor };
}

export function assignTodayQueues<M, T, S, R>(
  input: TodayQueueInput<M, T, S, R>,
): TodayQueues<M, T, S, R> {
  const a = input.accessors;
  // Transactions already placed in a higher-precedence queue. A deal in
  // this set is "spoken for" and cannot appear in a lower queue.
  const claimed = new Set<string>();

  // 1. Prevent harm — the highest precedence. Only milestones the risk
  //    taxonomy calls a genuine deal threat, deduped to one per deal so a
  //    single blown timeline doesn't spam the queue.
  const harm: M[] = [];
  for (const m of input.overdueMilestones) {
    const cat = classifyMilestone(a.milestoneType(m), a.milestoneLabel(m));
    const isHarm =
      cat === "contractual_deadline" ||
      cat === "closing_blocker" ||
      cat === "compliance_blocker";
    if (!isHarm) continue;
    const txn = a.milestoneTxn(m);
    if (claimed.has(txn)) continue; // one incident per deal
    claimed.add(txn);
    harm.push(m);
  }

  // Post-close nurture is pulled out of the active flow entirely (its own
  // lane), before Do-today assignment, so it never inflates active risk.
  const postClose: T[] = [];
  const activeTasks: T[] = [];
  for (const t of input.overdueTasks) {
    (isPostCloseNurture(a.taskTitle(t)) ? postClose : activeTasks).push(t);
  }

  // 2. Do today — active overdue tasks whose deal isn't already in harm.
  const doToday: T[] = [];
  for (const t of activeTasks) {
    if (claimed.has(a.taskTxn(t))) continue;
    doToday.push(t);
  }
  // Claim these deals only AFTER building the list, so multiple tasks on
  // the same (non-harm) deal all stay in Do today.
  for (const t of doToday) claimed.add(a.taskTxn(t));

  // 3. Waiting on others — silent deals not already claimed above.
  const waiting: S[] = [];
  for (const s of input.silentDeals) {
    const txn = a.silentTxn(s);
    if (claimed.has(txn)) continue;
    claimed.add(txn);
    waiting.push(s);
  }

  // 4. Informational At-risk — scored deals not surfaced in any actionable
  //    queue. Purely additive context; never duplicates the above.
  const atRisk: R[] = [];
  for (const r of input.scoredRisky) {
    if (claimed.has(a.scoredTxn(r))) continue;
    atRisk.push(r);
  }

  return { harm, doToday, postClose, waiting, atRisk };
}
