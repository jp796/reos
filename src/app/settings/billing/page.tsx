/**
 * /settings/billing — subscription management.
 *
 * - Shows current tier + status
 * - "Subscribe" buttons for each paid tier (start Stripe Checkout)
 * - "Manage" button (open Stripe Billing Portal — invoices, cards, cancel)
 *
 * When Stripe isn't configured yet (price IDs missing), the page is a
 * friendly placeholder explaining billing is on the way. We never
 * gate features pre-config — readTier() returns active=true so the
 * rest of the app keeps working.
 */

import { requireSession } from "@/lib/require-session";
import { redirect } from "next/navigation";
import { readTier } from "@/lib/tier-gate";
import { isStripeConfigured } from "@/lib/stripe";
import { BillingPanel } from "./BillingPanel";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  const { tier, active, status } = await readTier(actor.accountId);
  const stripeReady = isStripeConfigured();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">Billing</h1>
      <p className="mt-1 text-sm text-text-muted">
        REOS is subscription-based. Solo for one agent, Team for a small
        crew, Brokerage for a TC managing many agents.
      </p>

      <div className="mt-6 rounded-md border border-border bg-surface p-4">
        <div className="text-xs uppercase tracking-wide text-text-muted">
          Current plan
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-display text-2xl font-semibold capitalize">
            {tier}
          </span>
          {active ? (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
              {status ?? "active"}
            </span>
          ) : (
            <span className="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-600 ring-1 ring-accent-200">
              {status ?? "inactive"}
            </span>
          )}
        </div>
      </div>

      <div className="mt-6">
        <BillingPanel tier={tier} stripeReady={stripeReady} />
      </div>

      {!stripeReady && (
        <div className="mt-4 rounded-md border border-dashed border-border bg-surface-2/40 p-3 text-xs text-text-muted">
          Billing is in setup mode. All features are open while Stripe
          price IDs are still being configured.
        </div>
      )}
    </div>
  );
}
