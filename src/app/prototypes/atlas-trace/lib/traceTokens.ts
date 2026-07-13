/**
 * Atlas Trace — token + motion specification (REOS_05, deliverable #7).
 *
 * The single source for the trace design language. Prototype-only; nothing
 * here is imported by production. Colors reference the app's existing CSS
 * variables so light/dark stay in sync — the ONLY trace color is REOS ink
 * blue (brand-500 = #2563EB). No gradients, glows, sparkles, or particles.
 */

/** REOS ink blue — the active-trace color. Solid, never a gradient. */
export const INK = "rgb(37 99 235)"; // brand-500 #2563EB
export const INK_SOFT = "rgb(37 99 235 / 0.14)"; // source highlight wash
export const INK_HAIR = "rgb(37 99 235 / 0.45)"; // 1–2px connector at rest

/**
 * Motion grammar (ms). The standard source→result sequence. Each phase is a
 * discrete, causal step — motion always communicates causality, never masks
 * latency. Total ≈ 1.4s for a Focused trace; a Micro trace collapses to
 * highlight+transfer+settle (~450ms).
 */
export const MOTION = {
  sourceHighlight: 150,
  recognitionLabel: 200,
  connectorDraw: 300,
  valueTransfer: 400,
  destinationSettle: 200,
  provenanceAppear: 150,
} as const;

/** Cumulative offsets so a driver can schedule each phase from t=0. */
export const MOTION_OFFSET = {
  sourceHighlight: 0,
  recognitionLabel: MOTION.sourceHighlight,
  connectorDraw: MOTION.sourceHighlight + MOTION.recognitionLabel,
  valueTransfer:
    MOTION.sourceHighlight + MOTION.recognitionLabel + MOTION.connectorDraw,
  destinationSettle:
    MOTION.sourceHighlight +
    MOTION.recognitionLabel +
    MOTION.connectorDraw +
    MOTION.valueTransfer,
  provenanceAppear:
    MOTION.sourceHighlight +
    MOTION.recognitionLabel +
    MOTION.connectorDraw +
    MOTION.valueTransfer +
    MOTION.destinationSettle,
} as const;

export const MOTION_TOTAL =
  MOTION_OFFSET.provenanceAppear + MOTION.provenanceAppear;

/** Editorial easing — a short settle, slightly organic. Not bouncy. */
export const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/**
 * Interaction states — the shared vocabulary across REOS. Observation,
 * interpretation, recommendation, and action are kept distinct.
 */
export type TraceState =
  | "searching" // locating relevant evidence
  | "found" // likely fact identified, not committed
  | "connecting" // source being mapped to a REOS concept
  | "proposed" // material change awaits approval
  | "applied" // the result changed REOS
  | "needs_review" // conflict, ambiguity, or low confidence
  | "verified"; // confirmed by a human or trusted evidence

export const STATE_LABEL: Record<TraceState, string> = {
  searching: "Searching",
  found: "Found",
  connecting: "Connecting",
  proposed: "Proposed",
  applied: "Applied",
  needs_review: "Needs review",
  verified: "Verified",
};

/** Tone per state — ink for active work, amber for review, emerald verified. */
export const STATE_TONE: Record<
  TraceState,
  { dot: string; text: string; ring: string }
> = {
  searching: { dot: "bg-brand-500/50", text: "text-text-muted", ring: "ring-border" },
  found: { dot: "bg-brand-500", text: "text-brand-700", ring: "ring-brand-200" },
  connecting: { dot: "bg-brand-500", text: "text-brand-700", ring: "ring-brand-200" },
  proposed: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", ring: "ring-amber-200" },
  applied: { dot: "bg-brand-500", text: "text-brand-700", ring: "ring-brand-200" },
  needs_review: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", ring: "ring-amber-300" },
  verified: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", ring: "ring-emerald-200" },
};

/** Trace intensity — matched to the weight of the transformation. */
export type TraceIntensity = "ambient" | "micro" | "focused" | "cinematic";

/**
 * Confidence → verification requirement. Below this, a fact is flagged
 * "needs review" rather than silently applied (truthfulness rule).
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

export function stateForConfidence(confidence: number): TraceState {
  return confidence < REVIEW_CONFIDENCE_THRESHOLD ? "needs_review" : "applied";
}
