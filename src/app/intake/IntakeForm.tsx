"use client";

/**
 * IntakeForm — public lead-capture form. No auth, submits to
 * /api/intake. Includes a honeypot field to drop bot spam.
 *
 * Branches question set by side (buy / sell) — sellers see property
 * address, buyers see area-of-interest + budget.
 */

import { useState } from "react";

type Side = "" | "buy" | "sell";

export function IntakeForm() {
  const [side, setSide] = useState<Side>("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [areaOfInterest, setAreaOfInterest] = useState("");
  const [budget, setBudget] = useState("");
  const [timeline, setTimeline] = useState("");
  const [financingStatus, setFinancingStatus] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!side) {
      setErr("Pick buyer or seller");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          side,
          fullName,
          email,
          phone,
          propertyAddress: side === "sell" ? propertyAddress : undefined,
          areaOfInterest: side === "buy" ? areaOfInterest : undefined,
          budget,
          timeline,
          financingStatus,
          source,
          notes,
          website,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setSubmitted(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/40 p-6">
        <h2 className="font-display text-lg font-semibold text-emerald-900">
          Got it — thank you.
        </h2>
        <p className="mt-1 text-sm text-emerald-800">
          We&rsquo;ll reach out within one business day. If anything&rsquo;s
          urgent, call us directly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-border bg-surface p-5"
    >
      {/* Honeypot — hidden from humans */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute left-[-9999px]"
        aria-hidden="true"
      />

      <div>
        <div className="reos-label mb-1">I&rsquo;m looking to…</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSide("buy")}
            className={
              "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
              (side === "buy"
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text")
            }
          >
            Buy a home
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            className={
              "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
              (side === "sell"
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text")
            }
          >
            Sell my home
          </button>
        </div>
      </div>

      <Input
        label="Your name"
        value={fullName}
        onChange={setFullName}
        required
        placeholder="First Last"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          placeholder="you@example.com"
        />
        <Input
          label="Phone"
          value={phone}
          onChange={setPhone}
          type="tel"
          placeholder="(555) 555-5555"
        />
      </div>

      {side === "sell" && (
        <Input
          label="Property address"
          value={propertyAddress}
          onChange={setPropertyAddress}
          placeholder="509 Bent Ave, Cheyenne, WY"
        />
      )}
      {side === "buy" && (
        <Textarea
          label="Where / what are you looking for?"
          value={areaOfInterest}
          onChange={setAreaOfInterest}
          placeholder="Cheyenne, WY · 3+ beds · under $500k · ready to move soon"
          rows={3}
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Budget"
          value={budget}
          onChange={setBudget}
          placeholder="e.g. $350k–$450k"
        />
        <Input
          label="Timeline"
          value={timeline}
          onChange={setTimeline}
          placeholder="e.g. next 90 days"
        />
      </div>

      {side === "buy" && (
        <div>
          <div className="reos-label mb-1">Financing</div>
          <select
            value={financingStatus}
            onChange={(e) => setFinancingStatus(e.target.value)}
            className="w-full rounded border border-border bg-surface-2 px-2.5 py-2 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="">— choose one —</option>
            <option value="cash">Paying cash</option>
            <option value="preapproved">Pre-approved with a lender</option>
            <option value="needs_approval">Need help with a lender</option>
            <option value="not_sure">Not sure yet</option>
          </select>
        </div>
      )}

      <Input
        label="How did you hear about us? (optional)"
        value={source}
        onChange={setSource}
        placeholder="Referral, Google, Zillow…"
      />

      <Textarea
        label="Anything else we should know?"
        value={notes}
        onChange={setNotes}
        placeholder="Special situations, questions, timing constraints…"
        rows={3}
      />

      {err && (
        <div className="rounded border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {err}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !side}
        className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
      >
        {submitting ? "Sending…" : "Send"}
      </button>

      <p className="text-center text-xs text-text-subtle">
        Your info stays private. We don&rsquo;t share or sell leads.
      </p>
    </form>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="reos-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="reos-label">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows ?? 3}
        className="mt-1 w-full rounded border border-border bg-surface-2 px-2.5 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}
