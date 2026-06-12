/**
 * scripts/clear-stripe-residue.ts
 *
 * One-shot cleanup for the case where a Stripe test signup attached
 * its customer/subscription IDs to a pre-existing real-user Account
 * (because the webhook's idempotency-on-email path hit the update
 * branch). Restores the Account to its pre-test state.
 *
 * Usage:
 *   bun run scripts/clear-stripe-residue.ts <email>
 *
 * Safety:
 *   - Reads the User by email first; prints what's about to change.
 *   - Aborts if the User doesn't exist or has no accountId.
 *   - Only clears stripe fields and downgrades subscriptionTier/
 *     subscriptionStatus — never touches transactions, contacts,
 *     documents, or anything else.
 *   - Idempotent: re-running on an already-cleaned Account is a no-op.
 *
 * Intended as a temporary tool while we tune the webhook to skip
 * update branches when the existing User is already an admin / part
 * of an account predating signup. See OVERNIGHT_SHIP_LOG.md for the
 * planned refactor.
 */

import { PrismaClient } from "@prisma/client";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: bun run scripts/clear-stripe-residue.ts <email>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        accountId: true,
        account: {
          select: {
            id: true,
            businessName: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            subscriptionTier: true,
            subscriptionStatus: true,
            subscriptionRenewsAt: true,
          },
        },
      },
    });
    if (!user) {
      console.error(`No User found for email: ${email}`);
      process.exit(1);
    }
    if (!user.accountId || !user.account) {
      console.error(`User ${email} has no accountId — nothing to clean.`);
      process.exit(1);
    }

    const a = user.account;
    console.log("──────────────────────────────────────────────");
    console.log("Found Account:");
    console.log("  id                    :", a.id);
    console.log("  businessName          :", a.businessName);
    console.log("  stripeCustomerId      :", a.stripeCustomerId ?? "(null)");
    console.log("  stripeSubscriptionId  :", a.stripeSubscriptionId ?? "(null)");
    console.log("  subscriptionTier      :", a.subscriptionTier);
    console.log("  subscriptionStatus    :", a.subscriptionStatus ?? "(null)");
    console.log("  subscriptionRenewsAt  :", a.subscriptionRenewsAt?.toISOString() ?? "(null)");
    console.log("──────────────────────────────────────────────");

    if (
      a.stripeCustomerId === null &&
      a.stripeSubscriptionId === null &&
      a.subscriptionTier === "free" &&
      a.subscriptionStatus === null
    ) {
      console.log("Already clean. Nothing to do.");
      process.exit(0);
    }

    const updated = await prisma.account.update({
      where: { id: a.id },
      data: {
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionTier: "free",
        subscriptionStatus: null,
        subscriptionRenewsAt: null,
      },
      select: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionRenewsAt: true,
      },
    });

    console.log("\nAfter cleanup:");
    console.log("  stripeCustomerId      :", updated.stripeCustomerId ?? "(null)");
    console.log("  stripeSubscriptionId  :", updated.stripeSubscriptionId ?? "(null)");
    console.log("  subscriptionTier      :", updated.subscriptionTier);
    console.log("  subscriptionStatus    :", updated.subscriptionStatus ?? "(null)");
    console.log("  subscriptionRenewsAt  :", updated.subscriptionRenewsAt?.toISOString() ?? "(null)");
    console.log("\n✅ Account restored to pre-test state.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
