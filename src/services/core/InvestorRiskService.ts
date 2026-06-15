/**
 * InvestorRiskService — per-strategy risk signals (spec §10). Separate
 * from the retail RiskScoringService so investor logic never perturbs
 * the existing transaction risk score. Pure + deterministic: caller
 * assembles the input from the Asset + draws + economics + capital
 * stack; this returns a 0-100 score + factors in the same shape the UI
 * already renders.
 */

import type { Strategy } from "./DealClassifierService";

export interface InvestorRiskInput {
  strategy: Strategy;
  titlePath?: string | null;
  // rehab (flip / BRRRR)
  rehabBudget?: number | null;
  rehabSpent?: number | null;
  daysHeld?: number | null;
  hasBuyer?: boolean;
  daysToClosing?: number | null;
  // wholesale
  assignmentWindowDays?: number | null;
  buyerEmdCollected?: boolean;
  committedToSeller?: boolean;
  // rental
  dscr?: number | null;
  monthlyCashFlow?: number | null;
  leaseExpiringDays?: number | null;
  rentLateDays?: number | null;
  // creative
  underlyingPaymentLate?: boolean;
  balloonHorizonDays?: number | null;
  exitFunded?: boolean;
  insuranceLapsed?: boolean;
}

export interface InvestorRiskFactor {
  type: string;
  description: string;
  impact: number;
  severity: "low" | "medium" | "high";
}

export interface InvestorRisk {
  score: number;
  factors: InvestorRiskFactor[];
}

const HOLD_WARN_DAYS = 120;

export function computeInvestorRisk(input: InvestorRiskInput): InvestorRisk {
  const f: InvestorRiskFactor[] = [];
  const add = (
    type: string,
    description: string,
    impact: number,
    severity: InvestorRiskFactor["severity"],
  ) => f.push({ type, description, impact, severity });

  // ── Rehab over budget (flip + BRRRR) ──
  if (
    input.rehabBudget != null &&
    input.rehabSpent != null &&
    input.rehabBudget > 0 &&
    input.rehabSpent > input.rehabBudget
  ) {
    const overPct = (input.rehabSpent - input.rehabBudget) / input.rehabBudget;
    add(
      "rehab_over_budget",
      `Rehab over budget by ${Math.round(overPct * 100)}%`,
      Math.min(30, Math.round(overPct * 100)),
      overPct >= 0.15 ? "high" : "medium",
    );
  }

  // ── Holding costs accruing (takes_title held a long time) ──
  if (
    input.titlePath === "takes_title" &&
    input.daysHeld != null &&
    input.daysHeld > HOLD_WARN_DAYS
  ) {
    add(
      "holding_costs",
      `Held ${input.daysHeld}d — holding costs accruing`,
      Math.min(20, Math.round((input.daysHeld - HOLD_WARN_DAYS) / 10) + 5),
      input.daysHeld > 210 ? "high" : "medium",
    );
  }

  if (input.strategy === "flip") {
    // No buyer near completion
    if (
      input.hasBuyer === false &&
      input.daysToClosing != null &&
      input.daysToClosing <= 30
    ) {
      add("no_buyer_near_completion", "No buyer with completion near", 15, "high");
    }
  }

  if (input.strategy === "wholesale") {
    if (
      input.assignmentWindowDays != null &&
      input.assignmentWindowDays <= 7 &&
      input.hasBuyer === false
    ) {
      add(
        "assignment_window_closing",
        `Assignment window closing in ${input.assignmentWindowDays}d with no end buyer`,
        25,
        "high",
      );
    }
    if (input.committedToSeller && input.buyerEmdCollected === false) {
      add(
        "buyer_emd_not_collected",
        "Committed to seller but buyer EMD not collected",
        15,
        "medium",
      );
    }
  }

  if (input.strategy === "rental_brrrr") {
    if (input.dscr != null && input.dscr < 1.2) {
      add(
        "dscr_below_threshold",
        `DSCR ${input.dscr} below 1.2`,
        input.dscr < 1.0 ? 25 : 15,
        input.dscr < 1.0 ? "high" : "medium",
      );
    }
    if (input.monthlyCashFlow != null && input.monthlyCashFlow < 0) {
      add("negative_cash_flow", `Negative cash flow ${input.monthlyCashFlow}/mo`, 20, "high");
    }
    if (input.rentLateDays != null && input.rentLateDays > 5) {
      add("late_rent", `Rent late ${input.rentLateDays}d`, 12, "medium");
    }
    if (
      input.leaseExpiringDays != null &&
      input.leaseExpiringDays <= 45 &&
      input.leaseExpiringDays >= 0
    ) {
      add("lease_expiring", `Lease expiring in ${input.leaseExpiringDays}d`, 8, "low");
    }
  }

  if (input.strategy === "creative") {
    // Underlying-loan payment missed is top severity (spec §10).
    if (input.underlyingPaymentLate) {
      add(
        "underlying_payment_late",
        "Underlying mortgage payment missed/late — top severity",
        40,
        "high",
      );
    }
    if (
      input.balloonHorizonDays != null &&
      input.balloonHorizonDays <= 90 &&
      input.exitFunded === false
    ) {
      add(
        "balloon_unfunded",
        `Balloon in ${input.balloonHorizonDays}d with no exit funded`,
        30,
        "high",
      );
    }
    if (input.insuranceLapsed) {
      add("insurance_lapse", "Insurance lapse on creative-held asset", 15, "medium");
    }
  }

  const score = Math.min(
    100,
    f.reduce((s, x) => s + x.impact, 0),
  );
  return { score, factors: f };
}
