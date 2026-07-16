/**
 * dealLabels — the investor workflow "family" a deal routes to, plus its
 * human label. Keeps the transaction↔project state machine (ProjectEngine)
 * and the UI in agreement on:
 *   - which strategies have a PROJECT phase (rehab / make-ready / lease-up
 *     that sits between the acquisition and disposition transactions), vs
 *   - which OVERLAP (wholesale / double-close — the "project" work happens
 *     during the single active transaction; no Project object).
 *
 * Double-close is not a separate strategy — it is wholesale behaviour with a
 * distinct LABEL, carried by titlePath = "double_close" (per JP's decision).
 */

import type { Strategy, TitlePath } from "./DealClassifierService";

export type WorkflowFamily =
  | "retail"
  | "wholesale"
  | "double_close"
  | "wholetail"
  | "flip"
  | "rental"
  | "creative";

/** Strategies whose lifecycle includes a distinct PROJECT phase that is
 *  instantiated when the acquisition transaction closes. */
const PROJECT_PHASE_STRATEGIES: ReadonlySet<Strategy> = new Set<Strategy>([
  "flip",
  "wholetail",
  "rental_brrrr",
]);

export function hasProjectPhase(strategy: Strategy): boolean {
  return PROJECT_PHASE_STRATEGIES.has(strategy);
}

/** Wholesale (incl. double-close): disposition work OVERLAPS the single
 *  active transaction — assignment happens before closing, so there is no
 *  separate project object and no wait for close. */
export function isOverlapStrategy(strategy: Strategy): boolean {
  return strategy === "wholesale";
}

/** How a completed project puts the asset "back on market": a resale
 *  (flip / wholetail) creates a sell-side disposition; a rental leases up
 *  and holds (no resale). Drives the disposition transaction's nature. */
export function projectReturnsToMarketAs(strategy: Strategy): "sale" | "lease" | null {
  if (strategy === "flip" || strategy === "wholetail") return "sale";
  if (strategy === "rental_brrrr") return "lease";
  return null;
}

/** The workflow family, resolving double-close out of wholesale via titlePath. */
export function workflowFamily(strategy: Strategy, titlePath?: TitlePath | null): WorkflowFamily {
  switch (strategy) {
    case "retail":
      return "retail";
    case "flip":
      return "flip";
    case "wholetail":
      return "wholetail";
    case "rental_brrrr":
      return "rental";
    case "creative":
      return "creative";
    case "wholesale":
      return titlePath === "double_close" ? "double_close" : "wholesale";
  }
}

const FAMILY_LABEL: Record<WorkflowFamily, string> = {
  retail: "Retail (agency)",
  wholesale: "Wholesale (assignment)",
  double_close: "Wholesale (double close)",
  wholetail: "Wholetail",
  flip: "Flip",
  rental: "Rental / BRRRR",
  creative: "Creative finance",
};

/** Human display label for a deal's workflow type. */
export function workflowLabel(strategy: Strategy, titlePath?: TitlePath | null): string {
  return FAMILY_LABEL[workflowFamily(strategy, titlePath)];
}
