/**
 * /settings/account — owner-only account management.
 *
 * Right now the headline action is "Delete account." Plumbing for
 * other account-level controls (rename business, change owner email,
 * etc.) goes here as it's built.
 */

import { redirect, notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { readEntitlements } from "@/lib/entitlements";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { InvestorModuleToggle } from "./InvestorModuleToggle";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return notFound();
  if (actor.role !== "owner") redirect("/settings");

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: {
      id: true,
      businessName: true,
      subscriptionTier: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      deletionRequestedAt: true,
      createdAt: true,
    },
  });
  if (!account) return notFound();

  const entitlements = await readEntitlements(account.id);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="font-display text-h1 font-semibold">Account</h1>
        <p className="mt-1 text-sm text-text-muted">
          Owner-only controls for <span className="font-medium text-text">{account.businessName}</span>.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="font-display text-base font-semibold">Subscription</h2>
        <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-text-muted">Tier</dt>
          <dd className="capitalize">{account.subscriptionTier ?? "—"}</dd>
          <dt className="text-text-muted">Status</dt>
          <dd className="capitalize">{account.subscriptionStatus ?? "—"}</dd>
          <dt className="text-text-muted">Account created</dt>
          <dd>{account.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
        </dl>
        <p className="mt-4 text-xs text-text-muted">
          Change payment method or cancel at <a className="underline" href="/settings/billing">Settings → Billing</a>.
        </p>
      </section>

      <InvestorModuleToggle initialEnabled={entitlements.includes("investor")} />

      <DeleteAccountSection
        businessName={account.businessName}
        deletionRequestedAt={account.deletionRequestedAt?.toISOString() ?? null}
      />
    </div>
  );
}
