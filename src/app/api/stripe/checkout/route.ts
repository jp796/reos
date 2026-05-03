/**
 * POST /api/stripe/checkout
 * Body: { tier: "solo" | "team" | "brokerage" }
 *
 * Creates a Stripe Checkout Session for the requested tier and
 * returns the redirect URL. Reuses an existing customer when the
 * account already has stripeCustomerId; otherwise lazy-creates one.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { stripe, getPriceIdForTier, type Tier } from "@/lib/stripe";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { tier?: Tier };
  const tier = body.tier ?? "solo";
  if (!["solo", "team", "brokerage"].includes(tier)) {
    return NextResponse.json({ error: "invalid tier" }, { status: 400 });
  }
  const priceId = getPriceIdForTier(tier);
  if (!priceId) {
    return NextResponse.json(
      { error: `STRIPE_PRICE_ID_${tier.toUpperCase()} not configured` },
      { status: 503 },
    );
  }

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: {
      id: true,
      businessName: true,
      stripeCustomerId: true,
    },
  });
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  try {
    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe().customers.create({
        email: actor.email,
        name: account.businessName,
        metadata: { reosAccountId: account.id, reosUserId: actor.userId },
      });
      customerId = customer.id;
      await prisma.account.update({
        where: { id: account.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "https://myrealestateos.com";
    const session = await stripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/today?subscribed=1`,
      cancel_url: `${baseUrl}/?canceled=1`,
      metadata: { reosAccountId: account.id, tier },
      subscription_data: {
        metadata: { reosAccountId: account.id, tier },
      },
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    logError(e, {
      route: "/api/stripe/checkout",
      accountId: actor.accountId,
      userId: actor.userId,
      meta: { tier },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "checkout failed" },
      { status: 500 },
    );
  }
}
