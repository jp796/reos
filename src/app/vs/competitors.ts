/**
 * Competitor catalog for the /vs/[competitor] comparison pages.
 *
 * Each entry powers a dedicated page that Google can rank for the
 * "{competitor} alternative" search intent. Pricing + feature matrix
 * are sourced from each vendor's public marketing page (last audited
 * 2026-05). Update when materially out of date so the comparisons
 * stay defensible.
 *
 * Adding a new competitor: just append to COMPETITORS — the dynamic
 * route + sitemap pick it up automatically.
 */

export interface Competitor {
  /** URL slug — also keyword target. */
  slug: string;
  /** Display name as people search for it. */
  name: string;
  /** Short positioning tagline. */
  tagline: string;
  /** Public pricing — "starting at $X/mo" style. */
  pricingNote: string;
  /** Ownership / market context. One sentence. */
  ownership: string;
  /**
   * Feature-by-feature comparison. Three states:
   *   - "yes": both have it
   *   - "no": competitor lacks it, REOS has it
   *   - "limited": present but materially weaker than REOS
   * REOS itself is assumed "yes" on every row (it's our page).
   */
  features: Array<{
    feature: string;
    state: "yes" | "no" | "limited";
    /** Why we marked it this state — shown on hover / in the page body. */
    note?: string;
  }>;
  /** Where REOS specifically wins. 3-5 bullets. */
  wins: string[];
  /** Honest concessions — where the competitor is genuinely stronger. */
  concessions: string[];
  /** Search-intent variants we want to capture in <title> + meta. */
  searchPhrases: string[];
}

export const COMPETITORS: Record<string, Competitor> = {
  dotloop: {
    slug: "dotloop",
    name: "Dotloop",
    tagline: "Document-signing-first transaction management for agents and brokerages.",
    pricingNote: "Premium agent plan $31.99/mo · brokerage plans by quote",
    ownership: "Owned by Zillow Group since 2015.",
    features: [
      { feature: "Document e-signature + storage", state: "yes" },
      { feature: "Compliance file audit", state: "limited", note: "Manual broker review; no per-state automated checklist." },
      { feature: "AI contract reading", state: "no", note: "No automatic data extraction from uploaded PDFs." },
      { feature: "AI email-reply drafting", state: "no" },
      { feature: "Auto-post listings to social", state: "no" },
      { feature: "Auto-generate listing captions", state: "no" },
      { feature: "Listing-photo lookup from public sites", state: "no" },
      { feature: "Multi-brokerage per-customer checklists", state: "limited", note: "Per-team templates; not state-aware." },
      { feature: "AI transaction summary on every deal", state: "no" },
      { feature: "Gmail inbox watcher / auto-link to deals", state: "no" },
    ],
    wins: [
      "AI-driven, not document-driven — REOS reads your contract instead of asking you to retype the fields.",
      "Per-account compliance audit that knows your brokerage AND your state — Dotloop's checklists are generic.",
      "Auto-draft email replies against the transaction context — saves the 30+ minutes per deal that Dotloop leaves to manual typing.",
      "Listing photo auto-fetched from public sites and baked into Just Listed / Sold social posts.",
      "Per-customer brand kit — every social post matches your brokerage colors, fonts, and logo.",
    ],
    concessions: [
      "Dotloop's e-signature is more mature — it's their core product.",
      "Larger MLS-integration footprint today; REOS is adding integrations as customers ask.",
    ],
    searchPhrases: [
      "dotloop alternative",
      "switch from dotloop",
      "dotloop vs",
      "AI transaction coordinator instead of dotloop",
    ],
  },

  skyslope: {
    slug: "skyslope",
    name: "Skyslope",
    tagline: "Brokerage compliance + transaction management with strong audit tooling.",
    pricingNote: "Quote-based · typically $5-10 per agent/mo at brokerage tier",
    ownership: "Independent. Strong in compliance-heavy markets.",
    features: [
      { feature: "Brokerage-wide compliance audit", state: "yes" },
      { feature: "Document e-signature (DigiSign)", state: "yes" },
      { feature: "AI contract reading", state: "no" },
      { feature: "AI email-reply drafting", state: "no" },
      { feature: "Auto-post to FB / IG / LinkedIn", state: "no" },
      { feature: "Listing-photo lookup from public sites", state: "no" },
      { feature: "AI transaction summary", state: "no" },
      { feature: "Editable per-event caption templates", state: "no" },
      { feature: "Per-state compliance rules", state: "yes" },
      { feature: "Modern web UI (2024+ era)", state: "limited", note: "Functional but visually dated; mobile experience secondary." },
    ],
    wins: [
      "Skyslope is best-in-class for brokerage compliance — REOS adds the AI layer on top so individual TCs spend less time hunting documents.",
      "REOS reads contracts, drafts replies, generates social posts; Skyslope has none of that.",
      "Modern UI built for TCs working out of an inbox + transaction page — Skyslope's UX feels like it was built for compliance officers.",
      "Native social-posting flow with auto-fetched listing photos.",
    ],
    concessions: [
      "Skyslope's brokerage-admin compliance reporting is more mature for large multi-state brokerages.",
      "Their e-signature flow is built in; REOS uses your existing Google integration for Gmail + Calendar.",
    ],
    searchPhrases: [
      "skyslope alternative",
      "skyslope vs",
      "AI transaction coordinator vs skyslope",
    ],
  },

  "lone-wolf": {
    slug: "lone-wolf",
    name: "Lone Wolf",
    tagline: "Enterprise suite (TransactionDesk, zipForm, Brokermint) for large brokerages.",
    pricingNote: "Enterprise contracts only · per-agent licensing",
    ownership: "Lone Wolf Technologies — consolidated zipForm, TransactionDesk, Brokermint.",
    features: [
      { feature: "Forms library (zipForm)", state: "yes" },
      { feature: "Document e-signature", state: "yes" },
      { feature: "Back-office accounting", state: "yes" },
      { feature: "AI contract reading", state: "no" },
      { feature: "AI email-reply drafting", state: "no" },
      { feature: "Auto-post to social", state: "no" },
      { feature: "Self-serve signup", state: "no", note: "Requires brokerage contract + onboarding call." },
      { feature: "Time-to-first-deal under 10 minutes", state: "no" },
      { feature: "Modern API surface", state: "limited", note: "Enterprise integration partners only." },
    ],
    wins: [
      "REOS ships to a single agent in 10 minutes; Lone Wolf needs a brokerage contract and a multi-week onboarding.",
      "Every AI feature Lone Wolf doesn't have: contract reading, email drafts, social posts, compliance audit per brokerage.",
      "Self-serve pricing — Solo $97, Team $297, Brokerage $997. Lone Wolf is quote-only.",
      "Built for the 2026 stack: Cloud Run + Postgres + AI on every transaction page.",
    ],
    concessions: [
      "Lone Wolf is the right answer for a 500+ agent brokerage that needs back-office accounting + state-by-state forms libraries.",
      "Their zipForm library is comprehensive and deeply integrated with NAR.",
    ],
    searchPhrases: [
      "lone wolf alternative",
      "transactiondesk alternative",
      "zipform alternative",
      "lone wolf vs",
    ],
  },

  brokermint: {
    slug: "brokermint",
    name: "Brokermint",
    tagline: "Back-office + commission accounting for brokerages.",
    pricingNote: "$99/mo + per-user fees · part of Lone Wolf since 2023",
    ownership: "Acquired by Lone Wolf in 2023.",
    features: [
      { feature: "Commission accounting", state: "yes" },
      { feature: "Brokerage P&L reporting", state: "yes" },
      { feature: "Document storage + e-signature", state: "yes" },
      { feature: "AI contract reading", state: "no" },
      { feature: "AI email-reply drafting", state: "no" },
      { feature: "Social-post generation", state: "no" },
      { feature: "Listing-photo lookup", state: "no" },
      { feature: "Per-account compliance audit", state: "limited" },
      { feature: "Self-serve pricing tier under $100/mo", state: "yes" },
    ],
    wins: [
      "Brokermint's strong on commission accounting; REOS is strong on the actual deal flow.",
      "REOS includes everything Brokermint doesn't: AI features, per-customer compliance, social posting.",
      "Cleaner pricing model — Solo $97 covers all features, no per-feature add-ons.",
      "Modern UX — Brokermint's interface predates the Lone Wolf acquisition.",
    ],
    concessions: [
      "If your primary need is commission accounting + 1099 reporting, Brokermint is purpose-built for that.",
      "REOS doesn't do back-office accounting — that's not what we're solving.",
    ],
    searchPhrases: [
      "brokermint alternative",
      "brokermint vs",
    ],
  },

  "kw-command": {
    slug: "kw-command",
    name: "KW Command",
    tagline: "Keller Williams' proprietary agent suite.",
    pricingNote: "Bundled in KW agent fees · not available outside KW",
    ownership: "Built by Keller Williams; KW agents only.",
    features: [
      { feature: "KW-specific lead routing", state: "yes" },
      { feature: "Embedded MLS access (per market)", state: "yes" },
      { feature: "AI contract reading", state: "no" },
      { feature: "Open to non-KW agents", state: "no", note: "If you're not at KW you can't use Command." },
      { feature: "AI email-reply drafting", state: "no" },
      { feature: "Auto-post to social", state: "limited", note: "Templates yes; auto-photo + auto-caption no." },
      { feature: "Multi-brokerage support", state: "no" },
      { feature: "Survives changing brokerages", state: "no", note: "Leave KW, lose Command and every record in it." },
    ],
    wins: [
      "REOS is brokerage-agnostic — if you leave KW you keep every transaction, contact, and template.",
      "Every AI feature Command lacks: contract reading, drafted replies, smart audit, auto-photo social posts.",
      "Self-serve, no brokerage approval required.",
      "Per-customer brand kit — Command locks you into KW's identity.",
    ],
    concessions: [
      "Command's lead routing is tuned for KW's referral economy; that's specific to KW agents.",
      "If you're staying at KW forever, Command is bundled into your fees so the marginal cost is zero.",
    ],
    searchPhrases: [
      "kw command alternative",
      "leaving keller williams transaction software",
      "kw command vs",
    ],
  },
};

export function getCompetitor(slug: string): Competitor | null {
  return COMPETITORS[slug] ?? null;
}

export function allCompetitors(): Competitor[] {
  return Object.values(COMPETITORS);
}
