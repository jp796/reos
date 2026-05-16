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

/**
 * Map a Stripe price id back to our internal tier string. Defaults
 * to "solo" so a price-id mismatch (e.g. a manually-created
 * subscription) doesn't leave the account in a broken "no tier" state.
 */
function inferTierFromPrice(priceId: string | undefined): string {
  if (!priceId) return "solo";
  if (priceId === env.STRIPE_PRICE_ID_SOLO) return "solo";
  if (priceId === env.STRIPE_PRICE_ID_TEAM) return "team";
  if (priceId === env.STRIPE_PRICE_ID_BROKERAGE) return "brokerage";
  return "solo";
}

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
    // ── New self-serve signup → materialize the User + Account ─────
    // Fired by Stripe immediately after a successful Checkout Session.
    // If the session originated from /api/signup/start (metadata
    // .reosSignup === "1") we create the tenant on the fly. For
    // existing-account checkouts (an upgrade flow) we skip — those
    // are handled by the customer.subscription.* branch below.
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const md = session.metadata ?? {};
      if (md.reosSignup === "1") {
        const signupEmail = (md.signupEmail ?? "").toLowerCase().trim();
        const signupBusinessName = (md.signupBusinessName ?? "REOS Account").trim();
        const signupTier = (md.signupTier ?? "solo").trim();
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : (session.customer?.id ?? null);
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : (session.subscription?.id ?? null);

        if (!signupEmail || !customerId) {
          logError(new Error("signup webhook missing email or customerId"), {
            route: "/api/stripe/webhook",
            meta: { type: event.type, sessionId: session.id },
          });
        } else {
          // Idempotency: if a User+Account already materialized for
          // this email (webhook redelivery), just sync the latest
          // subscription state and stop.
          const existingUser = await prisma.user.findUnique({
            where: { email: signupEmail },
            select: { id: true, accountId: true },
          });
          if (existingUser?.accountId) {
            await prisma.account.update({
              where: { id: existingUser.accountId },
              data: {
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                subscriptionStatus: "active",
                subscriptionTier: signupTier,
              },
            });
          } else {
            // First-time materialization. Order matters because of
            // the User.accountId FK + Account.ownerUserId FK loop:
            //   1. Create a placeholder User (no accountId yet)
            //   2. Create the Account with ownerUserId = that user
            //   3. Update User.accountId to point at the Account
            // The User.email is unique; running this twice with the
            // same email collides on the User insert and aborts —
            // perfect idempotency for webhook redeliveries.
            const newUser = await prisma.user.create({
              data: {
                email: signupEmail,
                role: "owner",
                termsAcceptedAt: new Date(),
              },
              select: { id: true },
            });
            const newAccount = await prisma.account.create({
              data: {
                businessName: signupBusinessName,
                ownerUserId: newUser.id,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                subscriptionStatus: "active",
                subscriptionTier: signupTier,
              },
              select: { id: true },
            });
            await prisma.user.update({
              where: { id: newUser.id },
              data: { accountId: newAccount.id },
            });
          }
        }
      }
      // Done with checkout.session.completed regardless of branch.
      // Subscription state lands authoritatively via the
      // customer.subscription.* events that Stripe fires alongside.
      return NextResponse.json({ ok: true, type: event.type });
    }

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

// inferTierFromPrice moved to the top of the file so the new
// checkout.session.completed branch above can use it too.
