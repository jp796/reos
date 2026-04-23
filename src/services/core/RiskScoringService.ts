/**
 * RiskScoringService
 *
 * Deterministic, explainable per-transaction risk score. Pure function —
 * takes a Transaction with its milestones / tasks / communication events
 * and returns {score 0-100, factors, recommendation}.
 *
 * Why rule-based instead of AI: risk scoring needs to be predictable,
 * auditable, and fast. We're not classifying ambiguous signals — we're
 * summing concrete facts (overdue counts, days-since-contact, upcoming
 * deadlines). AI-powered summaries live in a separate service.
 */

import type {
  Milestone,
  Task,
  CommunicationEvent,
  Transaction,
  Contact,
} from "@prisma/client";
import type { TransactionRisk } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

// ==================================================
// INPUT SHAPE
// ==================================================

export interface RiskInput {
  transaction: Transaction & {
    contact: Contact;
    milestones: Milestone[];
    tasks: Task[];
    communicationEvents: CommunicationEvent[];
  };
  now?: Date;
}

// ==================================================
// SCORING RULES
// ==================================================

export class RiskScoringService {
  compute(input: RiskInput): TransactionRisk {
    const now = input.now ?? new Date();
    const t = input.transaction;
    const factors: TransactionRisk["factors"] = [];

    // --- Rule 1: overdue pending milestones (+5 each, cap 25, severity by count)
    // Date-less checklist items don't count as overdue — they have
    // no deadline yet.
    const overdueMs = t.milestones.filter(
      (m) =>
        !m.completedAt &&
        m.dueAt != null &&
        m.dueAt <= now &&
        m.status === "pending",
    );
    if (overdueMs.length > 0) {
      const impact = Math.min(overdueMs.length * 5, 25);
      factors.push({
        type: "overdue_milestones",
        description: `${overdueMs.length} overdue milestone${overdueMs.length === 1 ? "" : "s"}: ${overdueMs
          .slice(0, 3)
          .map((m) => m.label)
          .join(", ")}${overdueMs.length > 3 ? "…" : ""}`,
        impact,
        severity:
          overdueMs.length >= 4 ? "high" : overdueMs.length >= 2 ? "medium" : "low",
      });
    }

    // --- Rule 2: overdue pending tasks (+3 each, cap 15)
    const overdueTasks = t.tasks.filter(
      (x) => !x.completedAt && x.dueAt && x.dueAt <= now,
    );
    if (overdueTasks.length > 0) {
      const impact = Math.min(overdueTasks.length * 3, 15);
      factors.push({
        type: "overdue_tasks",
        description: `${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"}`,
        impact,
        severity: overdueTasks.length >= 3 ? "high" : "medium",
      });
    }

    // --- Rule 3: communication gap (+ scaled by days)
    const lastComm = t.communicationEvents
      .slice()
      .sort((a, b) => b.happenedAt.getTime() - a.happenedAt.getTime())[0];
    const lastTouch = lastComm?.happenedAt ?? t.createdAt;
    const daysSinceContact = Math.floor(
      (now.getTime() - lastTouch.getTime()) / DAY_MS,
    );
    if (daysSinceContact >= 7 && t.status === "active") {
      const impact = Math.min(daysSinceContact, 20);
      factors.push({
        type: "communication_gap",
        description: `No recent communication (${daysSinceContact} days)`,
        impact,
        severity: daysSinceContact >= 21 ? "high" : daysSinceContact >= 14 ? "medium" : "low",
      });
    }

    // --- Rule 4: deadline coming up this week with missing prep
    const weekFromNow = new Date(now.getTime() + 7 * DAY_MS);
    const imminent = t.milestones.filter(
      (m) =>
        !m.completedAt &&
        m.dueAt != null &&
        m.dueAt > now &&
        m.dueAt <= weekFromNow,
    );
    if (imminent.length >= 2) {
      factors.push({
        type: "cluster_deadlines",
        description: `${imminent.length} deadlines within 7 days: ${imminent
          .slice(0, 3)
          .map((m) => m.label)
          .join(", ")}${imminent.length > 3 ? "…" : ""}`,
        impact: Math.min(imminent.length * 4, 20),
        severity: imminent.length >= 4 ? "high" : "medium",
      });
    }

    // --- Rule 5: closing soon (<=7 days) with open milestones still pending
    if (t.closingDate && t.closingDate > now && t.closingDate <= weekFromNow) {
      const pendingCount = t.milestones.filter(
        (m) => !m.completedAt && m.status === "pending" && m.type !== "closing",
      ).length;
      if (pendingCount > 0) {
        factors.push({
          type: "closing_with_open_items",
          description: `Closing in ≤7d with ${pendingCount} unfinished milestone${pendingCount === 1 ? "" : "s"}`,
          impact: 15,
          severity: "high",
        });
      }
    }

    // --- Rule 6: missing contract or closing date on a non-Lead stage
    const isActiveFubStage =
      !!t.stageName &&
      !/lead|nurture/i.test(t.stageName) &&
      t.status === "active";
    if (isActiveFubStage && !t.contractDate) {
      factors.push({
        type: "missing_contract_date",
        description: "Active transaction with no contract date on file",
        impact: 5,
        severity: "low",
      });
    }
    if (isActiveFubStage && !t.closingDate) {
      factors.push({
        type: "missing_closing_date",
        description: "Active transaction with no closing date on file",
        impact: 5,
        severity: "low",
      });
    }

    // --- Rule 7: FUB tags that signal known trouble
    const rawFub = t.contact.rawFubPayloadJson;
    const tags: string[] = Array.isArray(rawFub)
      ? []
      : Array.isArray((rawFub as { tags?: unknown })?.tags)
        ? ((rawFub as { tags: string[] }).tags ?? [])
        : [];
    const troubleTagPatterns = [
      /financing.*delay/i,
      /title.*issue/i,
      /inspection.*fail/i,
      /appraisal.*short/i,
      /deal.*at.*risk/i,
    ];
    const trouble = tags.filter((t) =>
      troubleTagPatterns.some((pat) => pat.test(t)),
    );
    if (trouble.length > 0) {
      factors.push({
        type: "risk_tag",
        description: `FUB tag(s): ${trouble.join(", ")}`,
        impact: 15,
        severity: "high",
      });
    }

    // Aggregate
    const score = Math.min(
      factors.reduce((s, f) => s + f.impact, 0),
      100,
    );

    return {
      score,
      factors,
      recommendation: this.recommend(score, factors, t),
    };
  }

  private recommend(
    score: number,
    factors: TransactionRisk["factors"],
    t: RiskInput["transaction"],
  ): string {
    if (factors.length === 0) return "On track";

    const high = factors.filter((f) => f.severity === "high");
    if (high.length > 0) {
      const leader = high[0];
      if (leader.type === "closing_with_open_items") {
        return "Closing imminent — drive the remaining milestones to completion today";
      }
      if (leader.type === "communication_gap") {
        return `Silent for a while — reach out to ${t.contact.fullName} before end of day`;
      }
      if (leader.type === "overdue_milestones") {
        return "Work the overdue list — clear the oldest item first";
      }
      if (leader.type === "risk_tag") {
        return "Known problem signal on this deal — dig in before momentum stalls further";
      }
      return "Needs attention — address the highest-severity factor first";
    }
    if (score >= 25) {
      return "Monitor and chip away at pending items this week";
    }
    return "Low risk — routine follow-up is fine";
  }
}

// ==================================================
// HEALTH BUCKETS (for coarse UI)
// ==================================================

export type RiskHealth = "good" | "caution" | "risk" | "critical";

export function riskHealth(score: number): RiskHealth {
  if (score >= 60) return "critical";
  if (score >= 35) return "risk";
  if (score >= 15) return "caution";
  return "good";
}

export function riskHealthTone(h: RiskHealth): string {
  switch (h) {
    case "critical":
      return "border-red-200 bg-red-50/60 text-danger dark:bg-red-950/30";
    case "risk":
      return "border-accent-200 bg-accent-100/40 text-accent-500 dark:bg-accent-100/50";
    case "caution":
      return "border-accent-200 bg-accent-100/30 text-accent-500 dark:bg-accent-100/40";
    case "good":
      return "border-brand-200 bg-brand-50 text-brand-700";
  }
}
