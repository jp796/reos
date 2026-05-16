/**
 * POST /api/signup/start
 *
 * Public, unauth-gated. Starts the self-serve signup flow:
 *
 *   1. Validate { email, businessName, tier } from the body
 *   2. Idempotency: if a User+Account already exist for this email
 *      with an ACTIVE subscription, send them to /login. Pending
 *      (unpaid) signups can retry — we reuse the existing row so
 *      we don't accumulate phantom accounts every time someone
 *      clicks "Subscribe" twice
 *   3. Create a Stripe Checkout Session with reosSignup metadata
 *   4. Return the redirect URL — the browser sends the user to
 *      Stripe-hosted checkout
 *
 * NO User or Account row gets created until Stripe confirms payment.
 * The webhook (handled in /api/stripe/webhook) materializes the
 * tenant on `checkout.session.completed`. This protects against
 * spam-creating empty accounts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { stripe, getPriceIdForTier, type Tier } from "@/lib/stripe";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const VALID_TIERS: Tier[] = ["solo", "team", "brokerage"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  if (!env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe is not configured on this REOS deployment" },
      { status: 503 },
    );
  }

  let body: { email?: string; businessName?: string; tier?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // ── Validate input ──────────────────────────────────────────────
  const email = body.email?.trim().toLowerCase() ?? "";
  const businessName = body.businessName?.trim() ?? "";
  const tier = (body.tier ?? "solo") as Tier;

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (businessName.length < 2 || businessName.length > 200) {
    return NextResponse.json(
      { error: "businessName must be 2-200 characters" },
      { status: 400 },
    );
  }
  if (!VALID_TIERS.includes(tier)) {
    return NextResponse.json(
      { error: `tier must be one of: ${VALID_TIERS.join(", ")}` },
      { status: 400 },
    );
  }
  const priceId = getPriceIdForTier(tier);
  if (!priceId) {
    return NextResponse.json(
      { error: `Pricing for tier "${tier}" is not configured` },
      { status: 503 },
    );
  }

  // ── Idempotency: existing active-account email → redirect to login ─
  // We check by User.email — single source of truth for "is this
  // person already in REOS." If their account is active they should
  // sign in, not pay again. Pending/canceled accounts can re-signup.
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      accountId: true,
      account: {
        select: {
          subscriptionStatus: true,
          subscriptionTier: true,
        },
      },
    },
  });
  if (existingUser?.account?.subscriptionStatus === "active") {
    return NextResponse.json(
      {
        ok: false,
        reason: "already_active",
        message:
          "An active REOS account already exists for this email — sign in instead.",
        loginUrl: "/login",
      },
      { status: 409 },
    );
  }

  // ── Create the Stripe Checkout Session ───────────────────────────
  // metadata.reosSignup tells the webhook this is a brand-new signup
  // that needs the User + Account materialized post-payment.
  const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "https://myrealestateos.com";
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/login?activated=1&email=${encodeURIComponent(email)}`,
      cancel_url: `${baseUrl}/?signup=canceled`,
      metadata: {
        reosSignup: "1",
        signupEmail: email,
        signupBusinessName: businessName,
        signupTier: tier,
      },
      subscription_data: {
        // Stamping these on the subscription too means follow-up
        // events (renewal, cancel) keep the tier mapping even when
        // checkout-session metadata isn't included in the payload.
        metadata: {
          reosSignup: "1",
          signupEmail: email,
          signupBusinessName: businessName,
          signupTier: tier,
        },
      },
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    logError(e, {
      route: "/api/signup/start",
      meta: { email, tier, businessName },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "checkout creation failed" },
      { status: 500 },
    );
  }
}
