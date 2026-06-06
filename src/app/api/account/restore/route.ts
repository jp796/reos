/**
 * POST /api/account/restore
 *
 * Owner-only. Reverses a pending account deletion if we're still
 * inside the 30-day grace window. Clears deletionRequestedAt and
 * (best-effort) un-cancels the Stripe subscription so auto-renewal
 * resumes. If Stripe already finished canceling at period-end the
 * owner has to re-subscribe via the billing portal — we surface
 * that in the response so the UI can show the right prompt.
 *
 * If we're past the 30-day window the row may already be hard-
 * deleted by the scheduled purge route, in which case this returns
 * 404 — at that point the only recovery is a fresh signup.
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json(
      { error: "owner role required" },
      { status: 403 },
    );
  }

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: {
      id: true,
      businessName: true,
      stripeSubscriptionId: true,
      deletionRequestedAt: true,
    },
  });
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }
  if (!account.deletionRequestedAt) {
    return NextResponse.json(
      { ok: true, alreadyActive: true },
      { status: 200 },
    );
  }
  const ageMs = Date.now() - account.deletionRequestedAt.getTime();
  if (ageMs > GRACE_MS) {
    return NextResponse.json(
      { error: "grace period expired", expiredDaysAgo: Math.floor((ageMs - GRACE_MS) / (24*60*60*1000)) },
      { status: 410 },
    );
  }

  // Un-cancel the Stripe sub if it's still in cancel_at_period_end.
  // If the period already ended and Stripe marked it canceled, the
  // owner has to start a fresh subscription through /api/stripe/portal.
  let stripeOutcome: "restored" | "needs_resubscribe" | "no_sub" | "error" = "no_sub";
  if (account.stripeSubscriptionId && env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      const sub = await stripe.subscriptions.retrieve(account.stripeSubscriptionId);
      if (sub.status === "canceled") {
        stripeOutcome = "needs_resubscribe";
      } else if (sub.cancel_at_period_end) {
        await stripe.subscriptions.update(account.stripeSubscriptionId, {
          cancel_at_period_end: false,
        });
        stripeOutcome = "restored";
      } else {
        stripeOutcome = "restored";
      }
    } catch (err) {
      logError(err, { route: "account.restore.stripe" });
      stripeOutcome = "error";
    }
  }

  await prisma.account.update({
    where: { id: account.id },
    data: { deletionRequestedAt: null },
  });

  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: account.id,
        entityType: "account",
        entityId: account.id,
        ruleName: "account_delete_restored",
        actionType: "restore",
        sourceType: "user",
        confidenceScore: 1.0,
        decision: "restored",
        beforeJson: Prisma.JsonNull,
        afterJson: {
          restoredBy: { userId: actor.userId, email: actor.email },
          stripeOutcome,
        },
      },
    });
  } catch (err) {
    logError(err, { route: "account.restore.audit" });
  }

  return NextResponse.json({
    ok: true,
    stripe: stripeOutcome,
  });
}
