/**
 * POST /api/stripe/webhook
 *
 * Stripe sends subscription lifecycle events here. We persist the
 * latest tier + status onto the Account row so the rest of the app
 * can gate features. Bypass session auth — Stripe signs the request,
 * we verify the signature.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

export async function POST(req: NextRequest) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      rawBody,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (e) {
    logError(e, { route: "/api/stripe/webhook", meta: { phase: "verify" } });
    return NextResponse.json(
      { error: "invalid signature" },
      { status: 400 },
    );
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ ok: true, skipped: event.type });
  }

  try {
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      const tier =
        (sub.metadata?.tier as string | undefined) ??
        inferTierFromPrice(sub.items.data[0]?.price.id);
      const subAny = sub as unknown as { current_period_end?: number };
      const renewsAt = subAny.current_period_end
        ? new Date(subAny.current_period_end * 1000)
        : null;
      await prisma.account.updateMany({
        where: { stripeCustomerId: sub.customer as string },
        data: {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: sub.status,
          subscriptionTier: tier ?? "solo",
          subscriptionRenewsAt: renewsAt,
        },
      });
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await prisma.account.updateMany({
        where: { stripeCustomerId: sub.customer as string },
        data: {
          subscriptionStatus: "canceled",
          subscriptionTier: "free",
        },
      });
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      await prisma.account.updateMany({
        where: { stripeCustomerId: invoice.customer as string },
        data: { subscriptionStatus: "past_due" },
      });
    }
    return NextResponse.json({ ok: true, type: event.type });
  } catch (e) {
    logError(e, { route: "/api/stripe/webhook", meta: { type: event.type } });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "processing failed" },
      { status: 500 },
    );
  }
}

function inferTierFromPrice(priceId: string | undefined): string | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_ID_SOLO) return "solo";
  if (priceId === env.STRIPE_PRICE_ID_TEAM) return "team";
  if (priceId === env.STRIPE_PRICE_ID_BROKERAGE) return "brokerage";
  return null;
}
