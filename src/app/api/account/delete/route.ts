/**
 * POST /api/account/delete
 *
 * Owner-only. Schedules the acting tenant for deletion:
 *   1. Cancels the Stripe subscription at period-end (so the owner
 *      keeps access through what they already paid for).
 *   2. Stamps Account.deletionRequestedAt = now. From this moment
 *      the cross-app banner shows "scheduled for deletion in N days"
 *      and the owner can call /api/account/restore to undo.
 *   3. Writes an AutomationAuditLog entry so we can prove who did
 *      what, when, even after the row is gone.
 *
 * Hard-delete happens in /api/automation/purge-deleted-accounts
 * (Cloud Scheduler hits it daily; it cascades through Account →
 * Contact/Transaction/etc. via Prisma's onDelete: Cascade).
 *
 * Requires the body to confirm with the exact business name so a
 * stray click on the Delete button can't take a tenant down:
 *   { confirm: "<exact Account.businessName>" }
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json(
      { error: "owner role required" },
      { status: 403 },
    );
  }

  let body: { confirm?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
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
  if (account.deletionRequestedAt) {
    return NextResponse.json(
      {
        error: "already scheduled",
        scheduledAt: account.deletionRequestedAt.toISOString(),
      },
      { status: 409 },
    );
  }
  if (body.confirm !== account.businessName) {
    return NextResponse.json(
      {
        error: "confirmation does not match business name",
        hint: "type the exact business name to confirm",
      },
      { status: 400 },
    );
  }

  // Cancel the Stripe sub at period-end. Owner keeps access through
  // the billing period they already paid for; auto-renewal won't
  // fire. If Stripe is unreachable we still set the local flag —
  // billing reconciles when Stripe comes back.
  let stripeOutcome: "canceled_at_period_end" | "no_sub" | "error" = "no_sub";
  if (account.stripeSubscriptionId && env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.update(account.stripeSubscriptionId, {
        cancel_at_period_end: true,
        cancellation_details: {
          comment: "Customer requested account deletion via /settings/account",
        },
      });
      stripeOutcome = "canceled_at_period_end";
    } catch (err) {
      logError(err, { route: "account.delete.stripeCancel" });
      stripeOutcome = "error";
    }
  }

  const now = new Date();
  await prisma.account.update({
    where: { id: account.id },
    data: { deletionRequestedAt: now },
  });

  // Audit trail. Survives the soft-delete window; gets purged when
  // the account itself is purged (entries are scoped by accountId).
  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: account.id,
        entityType: "account",
        entityId: account.id,
        ruleName: "account_delete_requested",
        actionType: "schedule_delete",
        sourceType: "user",
        confidenceScore: 1.0,
        decision: "scheduled",
        beforeJson: Prisma.JsonNull,
        afterJson: {
          requestedBy: { userId: actor.userId, email: actor.email },
          stripeOutcome,
          scheduledAt: now.toISOString(),
          purgeEligibleAt: new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      },
    });
  } catch (err) {
    logError(err, { route: "account.delete.audit" });
  }

  return NextResponse.json({
    ok: true,
    scheduledAt: now.toISOString(),
    purgeEligibleAt: new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    stripe: stripeOutcome,
  });
}
