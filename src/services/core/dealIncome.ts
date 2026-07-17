/**
 * dealIncome — the dual-income ledger (FLAG 2). Computes a disposition's
 * INVESTMENT return (investor P&L) and REALTOR commission (agency GCI) from
 * JP's underwriting math, reusing FlipCalcModel (a faithful port of his
 * "Flip Calculator and Comparisions" workbook's BLANK TEMPLATE).
 *
 * Mapping strategy → the workbook's scenario:
 *   flip          → Fix & Flip   : profit = ARV − total expenses (B30);
 *                                  commission = ARV × listing% if seller agent (B35)
 *   wholetail     → Wholetail    : profit E30; commission E35
 *   rental_brrrr  → DSCR Rental   : 3-yr total profit H36; no sale → commission 0
 *   creative      → Owner Finance : 3-yr total profit K36; commission 0
 *   wholesale /
 *   double_close  → NOT in the workbook (assignment-fee math not modeled there)
 *                   → returns null so the ledger shows "—" until JP supplies it.
 *
 * Inputs come from a saved FlipAnalysis (inputsJson = FlipInputs) on the deal.
 */

import type { PrismaClient } from "@prisma/client";
import type { Strategy } from "./DealClassifierService";
import {
  computeFlip,
  DEFAULT_FLIP_INPUTS,
  type FlipInputs,
} from "./FlipCalcModel";

export interface DualIncome {
  investmentReturn: number | null;
  realtorCommission: number | null;
  /** Which workbook scenario produced it (audit / display). */
  basis: string;
}

const round = (n: number): number => Math.round(n);

/** Pure: compute the ledger for a strategy from a full FlipInputs set. */
export function computeDualIncome(strategy: Strategy, inputs: FlipInputs): DualIncome {
  const r = computeFlip(inputs);
  switch (strategy) {
    case "flip":
      return { investmentReturn: round(r.fixFlip.profit), realtorCommission: round(r.fixFlip.extraRealtor), basis: "flip_calc:fix_flip" };
    case "wholetail":
      return { investmentReturn: round(r.wholetail.profit), realtorCommission: round(r.wholetail.extraRealtor), basis: "flip_calc:wholetail" };
    case "rental_brrrr":
      // Rental holds/leases — no sale, so no realtor commission (matches the sheet).
      return { investmentReturn: round(r.rental.totalProfit3yr), realtorCommission: 0, basis: "flip_calc:dscr_rental_3yr" };
    case "creative":
      return { investmentReturn: round(r.ownerFinance.totalProfit3yr), realtorCommission: 0, basis: "flip_calc:owner_finance_3yr" };
    default:
      // wholesale / double_close / retail — not modeled in this workbook.
      return { investmentReturn: null, realtorCommission: null, basis: "not_in_workbook" };
  }
}

/** Merge a stored FlipAnalysis.inputsJson (possibly partial) with defaults. */
export function coerceFlipInputs(raw: unknown): FlipInputs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FLIP_INPUTS };
  return { ...DEFAULT_FLIP_INPUTS, ...(raw as Partial<FlipInputs>) };
}

/**
 * Compute the ledger for an Asset from its most recent FlipAnalysis. Looks at
 * every transaction on the asset (acquisition + disposition) for a saved
 * analysis. Returns nulls (with a basis of "no_analysis") when the deal has no
 * flip-calculator analysis to compute from — so the panel honestly shows "—".
 */
export async function dualIncomeForAsset(
  db: PrismaClient,
  assetId: string,
): Promise<DualIncome & { hasAnalysis: boolean }> {
  const asset = await db.asset.findUnique({ where: { id: assetId }, select: { strategy: true } });
  if (!asset) return { investmentReturn: null, realtorCommission: null, basis: "no_asset", hasAnalysis: false };

  const analysis = await db.flipAnalysis.findFirst({
    where: { transaction: { assetId } },
    orderBy: { updatedAt: "desc" },
    select: { inputsJson: true },
  });
  if (!analysis) {
    return { investmentReturn: null, realtorCommission: null, basis: "no_analysis", hasAnalysis: false };
  }

  const income = computeDualIncome(asset.strategy as Strategy, coerceFlipInputs(analysis.inputsJson));
  return { ...income, hasAnalysis: true };
}
