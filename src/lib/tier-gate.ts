/**
 * Tier gating — guard premium features behind subscription status.
 *
 * Usage in an API route:
 *
 *   const actor = await requireSession();
 *   if (actor instanceof NextResponse) return actor;
 *   const gate = await requireTier(actor.accountId, "solo");
 *   if (gate instanceof NextResponse) return gate;  // 402 if denied
 *   // ...continue
 *
 * The tier hierarchy is free < solo < team < brokerage. A request for
 * "solo" succeeds for any of solo/team/brokerage; "team" requires team
 * or brokerage; etc.
 *
 * SAFETY: gating only activates when STRIPE is configured. Until the
 * user populates prices, every account's tier is treated as the
 * highest tier so the app continues to work end-to-end. This avoids
 * shipping a half-paywall that locks out genuine usage.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isStripeConfigured, type Tier } from "@/lib/stripe";

const RANK: Record<Tier, number> = {
  free: 0,
  solo: 1,
  team: 2,
  brokerage: 3,
};

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export async function requireTier(
  accountId: string,
  minimum: Exclude<Tier, "free">,
): Promise<NextResponse | { tier: Tier; status: string | null }> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { subscriptionTier: true, subscriptionStatus: true },
  });
  const tier = (account?.subscriptionTier ?? "free") as Tier;
  const status = account?.subscriptionStatus ?? null;

  // Pre-billing mode: do not lock out anyone until Stripe is wired.
  if (!isStripeConfigured()) return { tier, status };

  // Active subscription required.
  if (!status || !ACTIVE_STATUSES.has(status)) {
    return NextResponse.json(
      {
        error: "subscription_required",
        message: `This feature requires the ${minimum} tier or higher.`,
        currentTier: tier,
        currentStatus: status,
      },
      { status: 402 },
    );
  }

  // Tier rank must meet or exceed the requirement.
  if (RANK[tier] < RANK[minimum]) {
    return NextResponse.json(
      {
        error: "upgrade_required",
        message: `This feature requires the ${minimum} tier — you're on ${tier}.`,
        currentTier: tier,
      },
      { status: 402 },
    );
  }

  return { tier, status };
}

/** Read tier without enforcing (for UI conditionals). Returns the tier
 * and a boolean indicating whether the subscription is currently
 * active / trialing. Pre-Stripe-config returns active=true so the UI
 * doesn't show paywall banners before billing is wired. */
export async function readTier(accountId: string): Promise<{
  tier: Tier;
  active: boolean;
  status: string | null;
}> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { subscriptionTier: true, subscriptionStatus: true },
  });
  const tier = (account?.subscriptionTier ?? "free") as Tier;
  const status = account?.subscriptionStatus ?? null;
  if (!isStripeConfigured()) return { tier, active: true, status };
  return { tier, active: !!status && ACTIVE_STATUSES.has(status), status };
}
