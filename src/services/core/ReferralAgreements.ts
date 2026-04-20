/**
 * Referral agreement lookup.
 *
 * Stored as JSON on Account.settingsJson.referralAgreements:
 *   [
 *     { "sourceMatch": "fastexpert.com",  "referralPercent": 0.25 },
 *     { "sourceMatch": "fastexpert",      "referralPercent": 0.25 },
 *     { "sourceMatch": "Agent Pronto",    "referralPercent": 0.30 },
 *     { "sourceMatch": "Sold.com",        "referralPercent": 0.30 },
 *     { "sourceMatch": "HomeLight",       "referralPercent": 0.35 },
 *     { "sourceMatch": "Realtor.com",     "referralPercent": 0.35 }
 *   ]
 *
 * Matching: case-insensitive substring match of `sourceMatch` against the
 * contact's source name. First match wins (list order matters — put the
 * more specific patterns earlier).
 */

import type { Prisma } from "@prisma/client";

export interface ReferralAgreement {
  sourceMatch: string;
  referralPercent: number; // 0.25 = 25%
  note?: string;
}

/** Fallback list used when settings don't define one. */
export const DEFAULT_REFERRAL_AGREEMENTS: readonly ReferralAgreement[] = [
  { sourceMatch: "fastexpert", referralPercent: 0.3 },
  { sourceMatch: "Agent Pronto", referralPercent: 0.3 },
  { sourceMatch: "agentpronto", referralPercent: 0.3 },
  { sourceMatch: "Sold.com", referralPercent: 0.3 },
  { sourceMatch: "HomeLight", referralPercent: 0.35 },
  { sourceMatch: "Realtor.com", referralPercent: 0.35 },
  { sourceMatch: "realtordotcom", referralPercent: 0.35 },
  { sourceMatch: "HouseJet", referralPercent: 0.3 },
];

export function resolveReferralAgreements(
  settingsJson: Prisma.JsonValue | null,
): ReferralAgreement[] {
  if (
    settingsJson &&
    typeof settingsJson === "object" &&
    !Array.isArray(settingsJson)
  ) {
    const raw = (settingsJson as Record<string, unknown>).referralAgreements;
    if (Array.isArray(raw)) {
      const parsed: ReferralAgreement[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const src = obj.sourceMatch;
        const pct = obj.referralPercent;
        if (typeof src === "string" && typeof pct === "number") {
          parsed.push({
            sourceMatch: src,
            referralPercent: pct,
            note: typeof obj.note === "string" ? obj.note : undefined,
          });
        }
      }
      if (parsed.length > 0) return parsed;
    }
  }
  return [...DEFAULT_REFERRAL_AGREEMENTS];
}

/**
 * Find the first agreement whose sourceMatch is a (case-insensitive)
 * substring of the contact's source. Returns null when nothing matches.
 * "Sphere", "Repeat Client", empty source → null.
 */
export function lookupReferralForSource(
  sourceName: string | null | undefined,
  agreements: ReferralAgreement[] = [...DEFAULT_REFERRAL_AGREEMENTS],
): ReferralAgreement | null {
  if (!sourceName) return null;
  const s = sourceName.toLowerCase();
  // Hard-exclude non-referral sources — safety net in case someone
  // accidentally adds "Sphere" to the list.
  const NEVER_REFERRAL = ["sphere", "repeat client", "referral", "sphere of influence"];
  if (NEVER_REFERRAL.some((n) => s.includes(n))) return null;

  for (const a of agreements) {
    if (!a.sourceMatch) continue;
    if (s.includes(a.sourceMatch.toLowerCase())) return a;
  }
  return null;
}

/**
 * Pure computation: given gross commission + referral percent, return
 * {amount, netBeforeSplitsAndMarketing}. Caller reduces further by
 * brokerage split and marketing cost to get true net.
 */
export function computeReferral(
  grossCommission: number,
  percent: number,
): { amount: number; netBeforeSplits: number } {
  const amount = Math.round(grossCommission * percent * 100) / 100;
  return {
    amount,
    netBeforeSplits: Math.round((grossCommission - amount) * 100) / 100,
  };
}
