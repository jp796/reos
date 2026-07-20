/**
 * REOS blended valuation engine (TypeScript port).
 *
 * Combines several valuation opinions for one property into a consensus number
 * with an honest confidence spread — the "RPR-style" blend.
 *
 * Sources (any subset may be present):
 *   engine   -> REOS's own comp + hedonic + condition ARV model (primary)
 *   rpr_rvm  -> RPR's Realtor Valuation Model (free NAR benefit, MLS-based)
 *   zillow / redfin / realtor -> portal estimates, hand-entered per deal (color)
 *   manual   -> any hand-keyed opinion of value
 *
 * Pure, dependency-free, deterministic. Safe to run in a Next.js route,
 * a server action, or a background job.
 */

export type SourceKey =
  | "engine"
  | "rpr_rvm"
  | "zillow"
  | "redfin"
  | "realtor"
  | "manual";

export type Confidence = "high" | "medium" | "low";

export interface SourceValue {
  source: SourceKey;
  value: number;
  enteredBy: "auto" | "manual";
  weight: number; // effective (renormalized) weight, filled by blend()
  isOutlier: boolean;
  included: boolean;
}

export interface BlendResult {
  blendedValue: number;
  valueLow: number;
  valueHigh: number;
  spreadPct: number;
  confidence: Confidence;
  sourceCount: number;
  targetCondition?: string;
  sources: SourceValue[];
}

export interface BlendOptions {
  weights?: Partial<Record<SourceKey, number>>;
  outlierThreshold?: number; // fraction off median that flags an outlier
  dropOutliers?: boolean;
  targetCondition?: string;
}

/** Base weights — relative; renormalized over whatever sources are present. */
export const DEFAULT_WEIGHTS: Record<SourceKey, number> = {
  engine: 0.45, // REOS model: market-tuned + condition-aware
  rpr_rvm: 0.35, // RPR RVM: MLS-based, licensed, free
  zillow: 0.08, // portal color, rural-weak
  redfin: 0.08,
  realtor: 0.04,
  manual: 0.2, // a human opinion; trusted more than a portal
};

export const OUTLIER_THRESHOLD = 0.25; // 25%
const HIGH_CONF_SPREAD = 0.07; // <=7% + >=3 sources -> high
const MED_CONF_SPREAD = 0.15; // <=15% -> medium; else low

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function confidenceFor(spreadPct: number, n: number): Confidence {
  if (n < 2) return "low"; // a lone opinion is never high confidence
  if (spreadPct <= HIGH_CONF_SPREAD && n >= 3) return "high";
  if (spreadPct <= MED_CONF_SPREAD) return "medium";
  return "low";
}

/** Portal sources are tagged manual since a human looked them up per deal. */
const MANUAL_SOURCES: ReadonlySet<SourceKey> = new Set([
  "zillow",
  "redfin",
  "realtor",
  "manual",
]);

/** Convenience constructor — pass whatever numbers you have; skip the rest. */
export function buildSources(
  input: Partial<Record<SourceKey, number>>,
): SourceValue[] {
  const order: SourceKey[] = [
    "engine",
    "rpr_rvm",
    "zillow",
    "redfin",
    "realtor",
    "manual",
  ];
  const out: SourceValue[] = [];
  for (const key of order) {
    const value = input[key];
    if (value == null) continue;
    if (!(value > 0)) {
      throw new Error(`${key}: value must be a positive number`);
    }
    out.push({
      source: key,
      value,
      enteredBy: MANUAL_SOURCES.has(key) ? "manual" : "auto",
      weight: 0,
      isOutlier: false,
      included: true,
    });
  }
  return out;
}

/**
 * Blend valuation opinions into one consensus result.
 *  1. Flag outliers vs the group median.
 *  2. Optionally drop them from the blend.
 *  3. Weighted-average the included sources (weights renormalized to 1).
 *  4. Compute the disagreement envelope + a confidence label.
 */
export function blend(
  sources: SourceValue[],
  opts: BlendOptions = {},
): BlendResult {
  if (sources.length === 0) {
    throw new Error("need at least one source to blend");
  }
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const outlierThreshold = opts.outlierThreshold ?? OUTLIER_THRESHOLD;
  const dropOutliers = opts.dropOutliers ?? true;

  // 1–2. Outlier flagging vs median of ALL provided values.
  const medAll = median(sources.map((s) => s.value));
  for (const s of sources) {
    s.isOutlier = Math.abs(s.value - medAll) / medAll > outlierThreshold;
    s.included = !(dropOutliers && s.isOutlier);
  }

  let included = sources.filter((s) => s.included);
  if (included.length === 0) {
    // Everything flagged (huge disagreement) -> keep all, low confidence.
    for (const s of sources) s.included = true;
    included = sources;
  }

  // 3. Effective weights, renormalized to sum to 1.
  const raw = included.map((s) => weights[s.source] ?? 0.05);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  included.forEach((s, i) => {
    s.weight = raw[i] / total;
  });
  const blendedValue = included.reduce((acc, s) => acc + s.value * s.weight, 0);

  // 4. Disagreement envelope + confidence.
  const incValues = included.map((s) => s.value);
  const low = Math.min(...incValues);
  const high = Math.max(...incValues);
  const medInc = median(incValues);
  const spreadPct = medInc ? (high - low) / medInc : 0;

  return {
    blendedValue,
    valueLow: low,
    valueHigh: high,
    spreadPct,
    confidence: confidenceFor(spreadPct, included.length),
    sourceCount: included.length,
    targetCondition: opts.targetCondition,
    sources,
  };
}

const LABELS: Record<SourceKey, string> = {
  engine: "REOS engine (comp + condition)",
  rpr_rvm: "RPR RVM (MLS-based)",
  zillow: "Zillow Zestimate",
  redfin: "Redfin Estimate",
  realtor: "Realtor.com",
  manual: "Manual opinion",
};

const usd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Plain-text valuation card for logs / CLI / debugging. */
export function renderCard(result: BlendResult, address = "Subject property"): string {
  const lines: string[] = [];
  lines.push("=".repeat(60));
  lines.push(`  VALUATION  |  ${address}`);
  if (result.targetCondition) {
    lines.push(`  Target (repaired) condition: ${result.targetCondition}`);
  }
  lines.push("=".repeat(60));
  for (const s of result.sources) {
    const wt = s.included ? `${Math.round(s.weight * 100)}%` : "--";
    const flag = s.isOutlier ? (s.included ? "  [outlier]" : "  [OUTLIER, dropped]") : "";
    lines.push(`  ${LABELS[s.source].padEnd(34)} ${usd(s.value).padStart(12)}  w=${wt}${flag}`);
  }
  lines.push("-".repeat(60));
  lines.push(`  ${"BLENDED VALUE".padEnd(34)} ${usd(result.blendedValue).padStart(12)}`);
  lines.push(`  Range  ${usd(result.valueLow)} - ${usd(result.valueHigh)}`);
  lines.push(`  Spread ${(result.spreadPct * 100).toFixed(1)}%   Confidence ${result.confidence.toUpperCase()} (${result.sourceCount} src)`);
  lines.push("=".repeat(60));
  return lines.join("\n");
}
