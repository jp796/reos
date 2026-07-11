/**
 * Canonical plan / entitlement configuration (remediation Phase 8 / §14).
 *
 * THE single source of truth for plan names, prices, seat limits, and
 * feature bullets. The public signup page, the in-app billing panel, and
 * server-side seat enforcement all read from here so pricing language can
 * never drift between surfaces (the "Team = up to 10 users" vs "up to 5
 * agents" bug). Change a number ONCE, here.
 */

export type PlanId = "solo" | "team" | "brokerage";

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in whole dollars. */
  priceMonthly: number;
  tagline: string;
  /** Seat limit; null = unlimited. THE authoritative value. */
  seats: number | null;
  /** Feature bullets (excluding the seat line, which is rendered from `seats`). */
  features: string[];
  highlighted?: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    id: "solo",
    name: "Solo",
    priceMonthly: 97,
    tagline: "One agent. Every workflow.",
    seats: 1,
    features: [
      "Unlimited transactions",
      "AI contract extraction",
      "Voice intake + Telegram brief",
      "Listing photos + social posts",
      "Email support",
    ],
  },
  {
    id: "team",
    name: "Team",
    priceMonthly: 297,
    tagline: "A TC and their agents on one workspace.",
    // AUTHORITATIVE seat limit — was "10" (signup) vs "5" (billing).
    seats: 5,
    features: [
      "Everything in Solo",
      "Multi-user roles + sharing",
      "Multi-tenant compliance",
      "Custom checklists",
      "Priority support",
    ],
    highlighted: true,
  },
  {
    id: "brokerage",
    name: "Brokerage",
    priceMonthly: 997,
    tagline: "Whole brokerage, white-labeled.",
    seats: null, // unlimited
    features: [
      "Everything in Team",
      "White-label brand kit",
      "Brokerage admin dashboard",
      "Multi-tenant accounts",
      "Onboarding call",
    ],
  },
];

export function planById(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** Human seat line, consistent everywhere. */
export function seatLabel(plan: Plan): string {
  if (plan.seats === null) return "Unlimited users";
  return plan.seats === 1 ? "1 user" : `Up to ${plan.seats} users`;
}

export function priceLabel(plan: Plan): string {
  return `$${plan.priceMonthly}/mo`;
}

/** Server-side seat enforcement: is adding another user allowed? */
export function seatLimitReached(planId: string, currentUsers: number): boolean {
  const plan = planById(planId);
  if (!plan || plan.seats === null) return false;
  return currentUsers >= plan.seats;
}
