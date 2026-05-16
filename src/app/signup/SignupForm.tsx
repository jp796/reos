"use client";

/**
 * SignupForm — client component for /signup. Posts to
 * /api/signup/start, which returns a Stripe Checkout URL; we
 * redirect the browser there. The User + Account materialize
 * server-side once Stripe confirms payment.
 */

import { useState } from "react";

type Tier = "solo" | "team" | "brokerage";

interface TierOption {
  id: Tier;
  label: string;
  price: string;
  tagline: string;
  features: string[];
  best: boolean;
}

const TIERS: TierOption[] = [
  {
    id: "solo",
    label: "Solo",
    price: "$97/mo",
    tagline: "Best for individual agents",
    features: ["1 user", "Unlimited transactions", "All AI features", "Email support"],
    best: false,
  },
  {
    id: "team",
    label: "Team",
    price: "$297/mo",
    tagline: "Solo agents & small teams",
    features: [
      "Up to 10 users",
      "Multi-tenant compliance",
      "Custom checklists",
      "Priority support",
    ],
    best: true,
  },
  {
    id: "brokerage",
    label: "Brokerage",
    price: "$997/mo",
    tagline: "Brokerage white-label",
    features: [
      "Unlimited users",
      "White-label brand kit",
      "Brokerage admin dashboard",
      "Onboarding call",
    ],
    best: false,
  },
];

export function SignupForm({
  initialTier,
  initialEmail,
}: {
  initialTier: Tier;
  initialEmail: string;
}) {
  const [tier, setTier] = useState<Tier>(initialTier);
  const [email, setEmail] = useState(initialEmail);
  const [businessName, setBusinessName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/signup/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          businessName: businessName.trim(),
          tier,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.reason === "already_active") {
        // Active account already exists — punt to login.
        window.location.href = data.loginUrl ?? "/login";
        return;
      }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Signup failed");
      }
      window.location.href = data.url; // Stripe-hosted checkout
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-border bg-surface p-6 shadow-sm"
    >
      {/* Tier picker — three cards, one selected */}
      <fieldset>
        <legend className="reos-label mb-3">Pick a plan</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {TIERS.map((t) => {
            const selected = tier === t.id;
            return (
              <label
                key={t.id}
                className={`cursor-pointer rounded-lg border-2 p-4 transition ${
                  selected
                    ? "border-brand-600 bg-brand-50"
                    : "border-border bg-surface-2 hover:border-brand-300"
                }`}
              >
                <input
                  type="radio"
                  name="tier"
                  value={t.id}
                  checked={selected}
                  onChange={() => setTier(t.id)}
                  className="sr-only"
                />
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-sm font-bold">{t.label}</span>
                  {t.best && (
                    <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      POPULAR
                    </span>
                  )}
                </div>
                <div className="mt-1 font-display text-lg font-bold text-text">
                  {t.price}
                </div>
                <div className="text-xs text-text-muted">{t.tagline}</div>
                <ul className="mt-3 space-y-1 text-xs text-text">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-1">
                      <span className="text-brand-700">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Identity fields */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="reos-label">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@brokerage.com"
            className="mt-1 w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <span className="mt-1 block text-[11px] text-text-muted">
            Use the Google email you&rsquo;ll sign in with after checkout.
          </span>
        </label>
        <label className="block">
          <span className="reos-label">Business name</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={200}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="House Needs Love LLC"
            className="mt-1 w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
      </div>

      {/* Submit */}
      <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-text-muted">
          Continue to Stripe to enter payment. No charge until you confirm.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {submitting ? "Loading Stripe…" : "Continue to payment →"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <p className="mt-4 text-[11px] text-text-muted">
        By continuing you agree to our{" "}
        <a className="underline" href="/terms">
          Terms
        </a>{" "}
        and{" "}
        <a className="underline" href="/privacy">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}
