/**
 * WeeklyFeatureEmail — composes the weekly "get more out of REOS" email for the
 * team: a rotating spotlight of real features + a productivity tip. Curated,
 * factual (every tip maps to a shipped feature), and always reviewed + sent by
 * the owner — never auto-blasted.
 */

export interface FeatureTip {
  title: string;
  body: string;
}

/** Curated feature spotlights — each is a real, shipped REOS capability. */
export const FEATURE_TIPS: FeatureTip[] = [
  { title: "Drop a contract, watch Atlas read it", body: "Upload a contract on a new deal and REOS reads every date, price, and party in ~60 seconds — you watch each fact land with a source badge (Atlas Trace)." },
  { title: "Every date shows its receipt", body: "On a deal's timeline, click the Source badge on any deadline to see the exact contract clause + page it came from. No more 'where did this date come from?'" },
  { title: "Addenda reconcile themselves", body: "Upload an addendum alongside the contract and REOS shows what changed — 'closing was Jul 30 → now Aug 15' — right on the timeline. No silent overwrites." },
  { title: "Flip Analysis on the deal", body: "Investor deals show a Flip Analysis card: ARV, rehab, projected profit, and max-offer across four exits (Fix&Flip, Wholetail, Rental, Owner Finance). Open the calculator to tweak." },
  { title: "The $ Pipeline is live", body: "The $ Pipeline dashboard totals expected income across every deal — flip profit, commissions, wholesale fees — so you always know what's coming." },
  { title: "Private money in one place", body: "Keep your capital partners in the Private money directory, attach them + amounts to deals, and draft a weekly 'how your money is working' update in one click." },
  { title: "Reminders that respect your lane", body: "Task reminders now only ping the TC assigned to a deal (you see everything). Closed deals go quiet. Assign a deal's TC from its Assignee picker." },
  { title: "Re-sync a stale deal", body: "If a deal's data looks off, hit Re-sync — REOS re-reads the contract, reconciles the documents, and pulls the deal's Gmail thread, then updates everything." },
  { title: "Atlas can answer deal questions", body: "Open a deal's Atlas chat and ask 'what's due this week?' or 'who's the other agent?' — it reads the deal and answers." },
  { title: "Compliance auditing built in", body: "Each deal runs a compliance checklist for your brokerage — missing items surface at the top so nothing slips before closing." },
  { title: "Listings → active in a click", body: "A listing that goes under contract converts to an active transaction with one button — the timeline and tasks generate automatically." },
  { title: "Share a client-safe timeline", body: "Send buyers/sellers a view-only timeline link — they see the milestones and dates without touching your workspace." },
];

/** Deterministic week index from a date (ISO-ish week count since epoch). */
export function weekIndex(now: Date): number {
  return Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
}

/** Pick `count` tips for a given week, rotating through the list. */
export function tipsForWeek(now: Date, count = 3): FeatureTip[] {
  const start = (weekIndex(now) * count) % FEATURE_TIPS.length;
  return Array.from({ length: Math.min(count, FEATURE_TIPS.length) }, (_, i) => FEATURE_TIPS[(start + i) % FEATURE_TIPS.length]);
}

export function buildFeatureEmail(now: Date, fromName: string): { subject: string; body: string } {
  const tips = tipsForWeek(now);
  const lines: string[] = [];
  lines.push("Hey team,");
  lines.push("");
  lines.push("A few ways to get more out of REOS this week:");
  lines.push("");
  for (const t of tips) {
    lines.push(`▸ ${t.title}`);
    lines.push(`   ${t.body}`);
    lines.push("");
  }
  lines.push("Questions on any of these? Just reply.");
  lines.push("");
  lines.push(fromName);
  return { subject: "Get more out of REOS this week", body: lines.join("\n") };
}
