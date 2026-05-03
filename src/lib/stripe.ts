import Stripe from "stripe";
import { env } from "./env";

export type Tier = "free" | "solo" | "team" | "brokerage";

const PRICE_BY_TIER: Record<Exclude<Tier, "free">, string | undefined> = {
  solo: env.STRIPE_PRICE_ID_SOLO,
  team: env.STRIPE_PRICE_ID_TEAM,
  brokerage: env.STRIPE_PRICE_ID_BROKERAGE,
};

export function getPriceIdForTier(tier: Tier): string | null {
  if (tier === "free") return null;
  return PRICE_BY_TIER[tier] ?? null;
}

let _client: Stripe | null = null;
export function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  if (!_client) {
    // SDK default API version applies — pinning here was breaking
    // type checks across SDK upgrades.
    _client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return _client;
}

export function isStripeConfigured(): boolean {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}
