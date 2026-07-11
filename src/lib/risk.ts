/**
 * Risk & attention taxonomy (remediation Phase 4 / §10).
 *
 * Replaces the flat "everything overdue is risk" accumulation with a strict
 * hierarchy. The single source of truth for classifying a milestone/task
 * into a risk category + severity, and for deciding what is post-close
 * nurture (which MUST NOT contribute to active-deal risk, §10 rule 1).
 */

export type RiskCategory =
  | "contractual_deadline" // missed/imminent contract dates
  | "compliance_blocker" // brokerage-compliance items
  | "closing_blocker" // title/financing/appraisal/insurance/possession/settlement
  | "communication_risk" // party silence
  | "operational_work" // normal tasks, not an immediate threat
  | "post_close_nurture"; // reviews, gifts, anniversaries — NOT active risk

export type Severity = "critical" | "high" | "normal" | "low";

/** Categories that count toward ACTIVE-deal risk / "prevent harm". */
export const ACTIVE_RISK_CATEGORIES: ReadonlySet<RiskCategory> = new Set([
  "contractual_deadline",
  "compliance_blocker",
  "closing_blocker",
  "communication_risk",
]);

/** Milestone.type → canonical risk category. */
const MILESTONE_CATEGORY: Record<string, RiskCategory> = {
  contract_effective: "contractual_deadline",
  earnest_money: "contractual_deadline",
  inspection: "contractual_deadline",
  inspection_objection: "contractual_deadline",
  title_commitment: "closing_blocker",
  title_objection: "closing_blocker",
  financing_approval: "closing_blocker",
  appraisal: "closing_blocker",
  walkthrough: "operational_work",
  closing: "closing_blocker",
  possession: "operational_work",
};

const POST_CLOSE_RE =
  /post.?close|review request|leave a review|google review|zillow|anniversary|\bgift\b|\bnps\b|thank.?you|referral ask|check.?in call/i;
const COMPLIANCE_RE = /broker compliance|submit to broker|rezen|compliance package|commission demand|disbursement/i;
const CLOSING_RE = /title|financing|appraisal|insurance|settlement|clear to close|wire|closing disclosure|funds to close/i;

export function isPostCloseNurture(text: string): boolean {
  return POST_CLOSE_RE.test(text);
}

/** Classify a milestone by its type. */
export function classifyMilestone(type: string, label?: string): RiskCategory {
  if (label && isPostCloseNurture(label)) return "post_close_nurture";
  return MILESTONE_CATEGORY[type] ?? "operational_work";
}

/** Classify a task by its title. */
export function classifyTask(title: string): RiskCategory {
  if (isPostCloseNurture(title)) return "post_close_nurture";
  if (COMPLIANCE_RE.test(title)) return "compliance_blocker";
  if (CLOSING_RE.test(title)) return "closing_blocker";
  return "operational_work";
}

export function isActiveRisk(category: RiskCategory): boolean {
  return ACTIVE_RISK_CATEGORIES.has(category);
}

/**
 * Severity from category + proximity + confidence (§10 rule: harm,
 * proximity, recoverability, confidence). daysToDue < 0 = overdue.
 */
export function severityFor(opts: {
  category: RiskCategory;
  daysToDue: number | null;
  confidence?: number; // 0..1; low-confidence extracted deadlines de-escalate (§10)
}): Severity {
  const { category, daysToDue, confidence = 1 } = opts;
  if (category === "post_close_nurture" || category === "operational_work") return "low";
  // Low-confidence extracted deadlines are not auto-critical (§10 / §4).
  const overdueOrImminent = daysToDue !== null && daysToDue <= 2;
  if (overdueOrImminent) {
    if (confidence < 0.5) return "high"; // needs review before critical
    return "critical";
  }
  if (daysToDue !== null && daysToDue <= 7) return "high";
  return "normal";
}
