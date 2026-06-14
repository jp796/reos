/**
 * DealClassifierService — auto-detect a deal's strategy / representation
 * / title-path at intake (spec §5).
 *
 * Pure, deterministic, side-effect-free: feed it a bag of signals
 * (extracted from a contract scan, voice intake, or manual upload) and
 * it returns the classification the Asset should be created with. It
 * does NOT touch the DB — the caller maps the result onto an Asset.
 *
 * Precedence (most-specific first): creative → wholesale → rental_brrrr
 * → flip → retail (the safe default). Every decision records a reason
 * so the intake UI can show "why" and the user can override.
 *
 * Spec §5 rules:
 *   Retail (agency): a third-party client + single contract-to-close +
 *     commission expectation.
 *   Flip: purchase + rehab budget + resale intent, no rent/refi/tenant.
 *   Wholesale: assignment clause + no rehab + cash-buyer disposition
 *     (double_close when two-closing intent but no assignment clause).
 *   Rental/BRRRR: purchase + rehab + rent estimate/DSCR + refi intent.
 *   Creative: sub-to / seller-finance / lease-option / wrap instruments.
 */

export type Strategy =
  | "retail"
  | "flip"
  | "wholesale"
  | "rental_brrrr"
  | "creative";
export type Representation = "agency" | "principal";
export type TitlePath =
  | "takes_title"
  | "assignment"
  | "double_close"
  | "contract_rights";
export type CreativeSubstructure =
  | "subject_to"
  | "seller_finance"
  | "lease_option"
  | "wrap";

export interface ClassificationSignals {
  /** Raw contract / intake text — scanned for creative-instrument and
   *  disposition phrasing the structured flags may not capture. */
  text?: string | null;
  /** A rehab / renovation budget is present. */
  hasRehabBudget?: boolean;
  /** Intent to resell on the retail market (listing, ARV-to-buyer). */
  hasResaleIntent?: boolean;
  /** A market-rent estimate / DSCR figure is present. */
  hasRentEstimate?: boolean;
  /** Intent to refinance (cash-out / DSCR refi — the BRRRR exit). */
  hasRefinanceIntent?: boolean;
  /** Contract carries an assignment clause. */
  hasAssignmentClause?: boolean;
  /** Cash-buyer / disposition language (assign to end buyer). */
  hasCashBuyerDisposition?: boolean;
  /** Two same-day closings intended (double close) with no assignment. */
  twoClosingIntent?: boolean;
  /** Representing a third-party client (not buying for own account). */
  hasClientParty?: boolean;
  /** A commission / GCI expectation (agency economics). */
  hasCommissionExpectation?: boolean;
}

export interface DealClassification {
  strategy: Strategy;
  representation: Representation;
  titlePath: TitlePath | null;
  creativeSubstructure: CreativeSubstructure | null;
  /** 0..1 — how confident the rule match is. Low values prompt the
   *  intake UI to ask the user to confirm. */
  confidence: number;
  /** Human-readable rationale, newest-decision-first. */
  reasons: string[];
}

const CREATIVE_PATTERNS: Array<{
  re: RegExp;
  sub: CreativeSubstructure;
  titlePath: TitlePath;
  label: string;
}> = [
  {
    re: /subject[\s-]*to(?:\s+(?:the\s+)?existing)?\b/i,
    sub: "subject_to",
    titlePath: "takes_title",
    label: "subject-to existing mortgage",
  },
  {
    re: /seller[\s-]*financ|owner[\s-]*(?:carry|financ)|carry[\s-]*back|owner\s+will\s+carry/i,
    sub: "seller_finance",
    titlePath: "takes_title",
    label: "seller / owner financing",
  },
  {
    re: /lease[\s-]*option|lease[\s-]*purchase|option\s+to\s+purchase|rent[\s-]*to[\s-]*own/i,
    sub: "lease_option",
    titlePath: "contract_rights",
    label: "lease-option",
  },
  {
    re: /\bwrap(?:[\s-]*around)?\b|all[\s-]*inclusive(?:\s+(?:trust\s+)?deed)?|\baitd\b/i,
    sub: "wrap",
    titlePath: "takes_title",
    label: "wrap / AITD",
  },
];

const BALLOON_RE = /balloon/i;

/**
 * Classify a deal from intake signals. Always returns a result — when
 * nothing matches, it falls back to retail/agency with low confidence
 * so the UI nudges the user rather than guessing wrong silently.
 */
export function classifyDeal(
  signals: ClassificationSignals,
): DealClassification {
  const text = signals.text ?? "";
  const reasons: string[] = [];

  // ── 1. Creative finance — distinctive instrument phrasing. ──────────
  const creativeHit = CREATIVE_PATTERNS.find((p) => p.re.test(text));
  if (creativeHit) {
    reasons.push(`creative: matched "${creativeHit.label}"`);
    if (BALLOON_RE.test(text)) reasons.push("balloon term present");
    return {
      strategy: "creative",
      representation: "principal",
      titlePath: creativeHit.titlePath,
      creativeSubstructure: creativeHit.sub,
      confidence: 0.8,
      reasons,
    };
  }

  // ── 2. Wholesale — assignment / disposition, no rehab. ──────────────
  const wholesaleish =
    (signals.hasAssignmentClause || signals.hasCashBuyerDisposition) &&
    !signals.hasRehabBudget;
  if (wholesaleish) {
    const titlePath: TitlePath = signals.hasAssignmentClause
      ? "assignment"
      : "double_close";
    reasons.push(
      signals.hasAssignmentClause
        ? "wholesale: assignment clause present, no rehab budget"
        : "wholesale: cash-buyer disposition, no rehab budget",
    );
    return {
      strategy: "wholesale",
      representation: "principal",
      titlePath,
      creativeSubstructure: null,
      confidence: signals.hasAssignmentClause ? 0.8 : 0.6,
      reasons,
    };
  }
  // Two-closing intent with no assignment clause and no rehab → double close.
  if (signals.twoClosingIntent && !signals.hasRehabBudget) {
    reasons.push("wholesale: two-closing intent, no assignment clause");
    return {
      strategy: "wholesale",
      representation: "principal",
      titlePath: "double_close",
      creativeSubstructure: null,
      confidence: 0.6,
      reasons,
    };
  }

  // ── 3. Rental / BRRRR — rehab + rent + refinance. ───────────────────
  if (
    signals.hasRehabBudget &&
    (signals.hasRentEstimate || signals.hasRefinanceIntent) &&
    !signals.hasResaleIntent
  ) {
    reasons.push(
      `rental/BRRRR: rehab budget + ${
        signals.hasRefinanceIntent ? "refinance intent" : "rent estimate"
      }, no resale`,
    );
    return {
      strategy: "rental_brrrr",
      representation: "principal",
      titlePath: "takes_title",
      creativeSubstructure: null,
      confidence: 0.75,
      reasons,
    };
  }

  // ── 4. Flip — rehab + resale, no rent/refi. ─────────────────────────
  if (
    signals.hasRehabBudget &&
    !signals.hasRentEstimate &&
    !signals.hasRefinanceIntent
  ) {
    reasons.push(
      `flip: rehab budget${
        signals.hasResaleIntent ? " + resale intent" : ""
      }, no rent/refi signals`,
    );
    return {
      strategy: "flip",
      representation: "principal",
      titlePath: "takes_title",
      creativeSubstructure: null,
      confidence: signals.hasResaleIntent ? 0.8 : 0.65,
      reasons,
    };
  }

  // ── 5. Retail (agency) — default. ───────────────────────────────────
  const agencyEvidence =
    !!signals.hasClientParty || !!signals.hasCommissionExpectation;
  reasons.push(
    agencyEvidence
      ? "retail: client party / commission expectation, no principal signals"
      : "retail: default — no investor signals detected",
  );
  return {
    strategy: "retail",
    representation: "agency",
    titlePath: "takes_title",
    creativeSubstructure: null,
    confidence: agencyEvidence ? 0.7 : 0.4,
    reasons,
  };
}
