/**
 * /signup — public self-serve signup. Three steps in one form:
 *   1. Pick a tier (Solo / Team / Brokerage)
 *   2. Enter email + business name
 *   3. Click Start → server creates a Stripe Checkout Session and
 *      redirects to Stripe-hosted payment
 *
 * No User or Account row exists until Stripe confirms payment;
 * /api/stripe/webhook materializes the tenant on
 * checkout.session.completed. See /api/signup/start for the
 * server-side flow.
 *
 * Pre-selects the tier via ?tier=solo|team|brokerage so homepage
 * CTAs can deep-link.
 */

import { SignupForm } from "./SignupForm";

interface PageProps {
  searchParams: Promise<{ tier?: string; email?: string }>;
}

export const metadata = {
  title: "Start free trial · REOS",
  description:
    "Start a Real Estate OS subscription. AI transaction coordinator software for TCs, agents, and brokerages.",
};

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tier =
    params.tier === "solo" || params.tier === "team" || params.tier === "brokerage"
      ? params.tier
      : "solo";

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <header className="mb-8 text-center">
          <h1 className="font-display text-h1 font-bold text-text">
            Start your REOS subscription
          </h1>
          <p className="mt-2 text-text-muted">
            AI transaction coordinator software. 10× deals per TC. Any
            brokerage.
          </p>
        </header>

        <SignupForm initialTier={tier} initialEmail={params.email ?? ""} />

        <p className="mt-8 text-center text-xs text-text-muted">
          Already have an account?{" "}
          <a className="font-medium text-brand-700 underline" href="/login">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
