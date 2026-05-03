/**
 * POST /api/stripe/portal
 *
 * Creates a Stripe Billing Portal session for the calling account so
 * users can manage their subscription, update payment methods, and
 * download invoices without leaving Stripe's hosted UI. Returns the
 * portal URL — the client redirects to it.
 *
 * Required: account must already have a stripeCustomerId. That row
 * is created the first time the user runs through /api/stripe/checkout.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { stripe } from "@/lib/stripe";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { stripeCustomerId: true },
  });
  if (!account?.stripeCustomerId) {
    return NextResponse.json(
      { error: "no Stripe customer — start checkout first" },
      { status: 400 },
    );
  }

  try {
    const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "https://myrealestateos.com";
    const session = await stripe().billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${baseUrl}/settings/billing`,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    logError(e, {
      route: "/api/stripe/portal",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "portal failed" },
      { status: 500 },
    );
  }
}
