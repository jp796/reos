/**
 * DealEconomicsService — per-strategy economics (spec §9). Pure,
 * deterministic calculators. The caller stores the result on
 * Asset.economicsJson and the Production rollup reads it.
 *
 *   Retail     → commission / GCI
 *   Flip       → all-in cost → sale → profit, ROI, days-to-flip
 *   Wholesale  → assignment fee (spread), EMD exposure, days-to-assign
 *   Rental     → cash flow, cap rate, DSCR, capital-left-in after refi
 *   Creative   → monthly cash flow, entry/exit spread, balloon horizon
 *
 * All money is plain numbers (USD). Percentages are returned as
 * decimals (0.18 = 18%). Null inputs degrade gracefully — partial deals
 * still compute what they can and leave the rest null.
 */

import type { Strategy } from "./DealClassifierService";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const days = (a?: Date | null, b?: Date | null): number | null =>
  a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : null;

// ── Retail ────────────────────────────────────────────────────────────
export interface RetailEconomicsInput {
  salePrice?: number | null;
  commissionPercent?: number | null; // human % (2.5 = 2.5%)
  grossCommission?: number | null;
  referralFee?: number | null;
  brokerageSplit?: number | null;
}
export interface RetailEconomics {
  kind: "retail";
  grossCommission: number | null;
  netCommission: number | null;
}
function retail(i: RetailEconomicsInput): RetailEconomics {
  let gci = i.grossCommission ?? null;
  if (gci == null && i.salePrice && i.commissionPercent) {
    gci = r2((i.salePrice * i.commissionPercent) / 100);
  }
  const net =
    gci == null ? null : r2(gci - (i.referralFee ?? 0) - (i.brokerageSplit ?? 0));
  return { kind: "retail", grossCommission: gci, netCommission: net };
}

// ── Flip ──────────────────────────────────────────────────────────────
export interface FlipEconomicsInput {
  purchasePrice?: number | null;
  rehabBudget?: number | null;
  holdingCosts?: number | null;
  buyingCosts?: number | null;
  salePrice?: number | null;
  sellingCosts?: number | null;
  purchaseDate?: Date | null;
  saleDate?: Date | null;
}
export interface FlipEconomics {
  kind: "flip";
  allInCost: number | null;
  profit: number | null;
  roi: number | null; // decimal
  daysToFlip: number | null;
}
function flip(i: FlipEconomicsInput): FlipEconomics {
  const parts = [i.purchasePrice, i.rehabBudget, i.holdingCosts, i.buyingCosts];
  const allIn = parts.some((p) => p != null)
    ? r2(parts.reduce<number>((s, p) => s + (p ?? 0), 0))
    : null;
  const profit =
    i.salePrice != null && allIn != null
      ? r2(i.salePrice - (i.sellingCosts ?? 0) - allIn)
      : null;
  const roi = profit != null && allIn && allIn > 0 ? r4(profit / allIn) : null;
  return {
    kind: "flip",
    allInCost: allIn,
    profit,
    roi,
    daysToFlip: days(i.purchaseDate, i.saleDate),
  };
}

// ── Wholesale ─────────────────────────────────────────────────────────
export interface WholesaleEconomicsInput {
  assignmentFee?: number | null;
  emd?: number | null;
  contractDate?: Date | null;
  assignedDate?: Date | null;
}
export interface WholesaleEconomics {
  kind: "wholesale";
  spread: number | null;
  emdExposure: number | null;
  daysToAssign: number | null;
}
function wholesale(i: WholesaleEconomicsInput): WholesaleEconomics {
  return {
    kind: "wholesale",
    spread: i.assignmentFee ?? null,
    emdExposure: i.emd ?? null,
    daysToAssign: days(i.contractDate, i.assignedDate),
  };
}

// ── Rental / BRRRR ────────────────────────────────────────────────────
export interface RentalEconomicsInput {
  monthlyRent?: number | null;
  monthlyDebtService?: number | null;
  monthlyTaxes?: number | null;
  monthlyInsurance?: number | null;
  monthlyMgmt?: number | null;
  monthlyMaintenance?: number | null;
  monthlyOtherOpex?: number | null;
  allInCost?: number | null; // purchase + rehab + holding
  totalInvested?: number | null; // cash in
  cashOutRefi?: number | null; // cash pulled at refi
}
export interface RentalEconomics {
  kind: "rental_brrrr";
  monthlyCashFlow: number | null;
  noiAnnual: number | null;
  capRate: number | null; // decimal
  dscr: number | null;
  capitalLeftIn: number | null;
}
function rental(i: RentalEconomicsInput): RentalEconomics {
  const opex =
    (i.monthlyTaxes ?? 0) +
    (i.monthlyInsurance ?? 0) +
    (i.monthlyMgmt ?? 0) +
    (i.monthlyMaintenance ?? 0) +
    (i.monthlyOtherOpex ?? 0);
  const rent = i.monthlyRent ?? null;
  const cashFlow =
    rent != null ? r2(rent - opex - (i.monthlyDebtService ?? 0)) : null;
  // NOI excludes debt service (operating only).
  const noiAnnual = rent != null ? r2((rent - opex) * 12) : null;
  const capRate =
    noiAnnual != null && i.allInCost && i.allInCost > 0
      ? r4(noiAnnual / i.allInCost)
      : null;
  const dscr =
    noiAnnual != null && i.monthlyDebtService && i.monthlyDebtService > 0
      ? r2(noiAnnual / (i.monthlyDebtService * 12))
      : null;
  const capitalLeftIn =
    i.totalInvested != null
      ? r2(i.totalInvested - (i.cashOutRefi ?? 0))
      : null;
  return {
    kind: "rental_brrrr",
    monthlyCashFlow: cashFlow,
    noiAnnual,
    capRate,
    dscr,
    capitalLeftIn,
  };
}

// ── Creative ──────────────────────────────────────────────────────────
export interface CreativeEconomicsInput {
  incomingMonthlyPayment?: number | null; // tenant/buyer pays us
  underlyingMonthlyPayment?: number | null; // we pay the existing loan
  monthlyExpenses?: number | null;
  entryCost?: number | null;
  purchasePrice?: number | null;
  expectedExitValue?: number | null;
  balloonDate?: Date | null;
  now?: Date | null;
}
export interface CreativeEconomics {
  kind: "creative";
  monthlyCashFlow: number | null;
  entrySpread: number | null; // value - (price + entry cost)
  exitSpread: number | null; // exit value - price
  balloonHorizonDays: number | null;
}
function creative(i: CreativeEconomicsInput): CreativeEconomics {
  const cashFlow =
    i.incomingMonthlyPayment != null
      ? r2(
          i.incomingMonthlyPayment -
            (i.underlyingMonthlyPayment ?? 0) -
            (i.monthlyExpenses ?? 0),
        )
      : null;
  const entrySpread =
    i.expectedExitValue != null && i.purchasePrice != null
      ? r2(i.expectedExitValue - i.purchasePrice - (i.entryCost ?? 0))
      : null;
  const exitSpread =
    i.expectedExitValue != null && i.purchasePrice != null
      ? r2(i.expectedExitValue - i.purchasePrice)
      : null;
  return {
    kind: "creative",
    monthlyCashFlow: cashFlow,
    entrySpread,
    exitSpread,
    balloonHorizonDays: days(i.now ?? new Date(), i.balloonDate),
  };
}

export type DealEconomics =
  | RetailEconomics
  | FlipEconomics
  | WholesaleEconomics
  | RentalEconomics
  | CreativeEconomics;

export type EconomicsInput =
  | RetailEconomicsInput
  | FlipEconomicsInput
  | WholesaleEconomicsInput
  | RentalEconomicsInput
  | CreativeEconomicsInput;

/** Dispatch to the right calculator for the strategy. */
export function computeEconomics(
  strategy: Strategy,
  input: EconomicsInput,
): DealEconomics {
  switch (strategy) {
    case "flip":
      return flip(input as FlipEconomicsInput);
    case "wholesale":
      return wholesale(input as WholesaleEconomicsInput);
    case "rental_brrrr":
      return rental(input as RentalEconomicsInput);
    case "creative":
      return creative(input as CreativeEconomicsInput);
    case "retail":
    default:
      return retail(input as RetailEconomicsInput);
  }
}

/**
 * Profit reconciliation (spec §9): actual vs locked projection. Returns
 * the variance and variance % for the headline metric of each strategy
 * (profit for flip, spread for wholesale, etc.).
 */
export function reconcile(
  projected: number | null | undefined,
  actual: number | null | undefined,
): { variance: number | null; variancePct: number | null } {
  if (projected == null || actual == null) {
    return { variance: null, variancePct: null };
  }
  const variance = r2(actual - projected);
  const variancePct = projected !== 0 ? r4(variance / Math.abs(projected)) : null;
  return { variance, variancePct };
}
