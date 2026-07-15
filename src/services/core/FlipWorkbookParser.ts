/**
 * FlipWorkbookParser — maps one property tab of JP's "Flip Calculator and
 * Comparisons" workbook into FlipInputs, so a filled-in sheet reproduces the
 * exact numbers via computeFlip. Reusable by the one-time import script and the
 * in-app workbook uploader.
 *
 * Cell layout (from the workbook's per-property tabs; value columns are B/E/H/K):
 *   Property:  A5 address · C5|E5 sqft · H5 commission type
 *   Purchase:  B9 offer · B10 wholesaler fee · B11 title% · B20 Fix&Flip ARV (manual)
 *   Carry:     E9 tax · E10 insurance · E11 utilities · E12 other (annual)
 *   Comm:      H9 listing% · H10 buyer% · H11 concessions
 *   Fix&Flip:  B17 rehab · B18 rehab choice · B21 months · B22 int% · B23 pts% · B31/B32 split
 *   Wholetail: E17 rehab · E20 ARV · E21 months · E22 int% · E23 pts%
 *   Rental:    H17 rehab · H18 ARV · H20 rent · H21 ins/mo · H22 tax/yr · H27 amort · H28 rate
 *   OwnFin:    K17 rehab · K18 sale · K19 market value · K25 amort · K26 rate
 *   Comps:     rows 42–46 (A address · B sale price · C sqft)
 */

import type { WorkSheet } from "xlsx";
import {
  DEFAULT_FLIP_INPUTS,
  type FlipInputs,
  type CommissionType,
  type RehabChoice,
  type Comp,
} from "./FlipCalcModel";

function raw(ws: WorkSheet, addr: string): unknown {
  return (ws[addr] as { v?: unknown } | undefined)?.v ?? null;
}
function num(ws: WorkSheet, addr: string): number {
  const v = raw(ws, addr);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return 0;
}
/** num with a fallback used ONLY when the cell is truly empty (not when it's 0). */
function numOr(ws: WorkSheet, addr: string, fallback: number): number {
  return raw(ws, addr) == null ? fallback : num(ws, addr);
}
/** A rate/percent cell. Real rates are fractions (≤ ~1). A value > 1 means the
 *  sheet is malformed (a dollar amount landed in a percent cell) — treat as 0
 *  so a broken tab can't produce billion-dollar garbage. */
function pct(ws: WorkSheet, addr: string, fallback = 0): number {
  const v = raw(ws, addr) == null ? fallback : num(ws, addr);
  return v > 1 ? 0 : v;
}
function text(ws: WorkSheet, addr: string): string {
  const v = raw(ws, addr);
  return v == null ? "" : String(v).trim();
}

export interface ParsedFlipTab {
  tabName: string;
  address: string;
  inputs: FlipInputs;
  /** The sheet's own computed values, for verifying our recompute matches. */
  sheetProfit: number | null; // B30
  sheetMaxOfferForProfit: number | null; // B27
}

export function parseFlipTab(ws: WorkSheet, tabName: string): ParsedFlipTab {
  const commRaw = text(ws, "H5");
  const commissionType: CommissionType =
    commRaw === "Seller Agent" ? "Seller Agent" : commRaw === "Referral Agent" ? "Referral Agent" : "None";

  const rehabRaw = text(ws, "B18");
  const rehabChoice: RehabChoice = /big/i.test(rehabRaw)
    ? "Big Rehab Estimate"
    : /light/i.test(rehabRaw)
      ? "Light Rehab Estimate"
      : "Medium Rehab Estimate";

  const flipComps: Comp[] = [];
  for (let r = 42; r <= 46; r++) {
    const salePrice = num(ws, `B${r}`);
    const sqft = num(ws, `C${r}`);
    if (salePrice > 0 && sqft > 0) flipComps.push({ salePrice, sqft });
  }

  const offerPrice = num(ws, "B9");
  const flipRehabBudget = num(ws, "B17");
  const flipHoldingMonths = numOr(ws, "B21", 6);
  const flipInterestRate = pct(ws, "B22", 0.12);
  const flipPointsPct = pct(ws, "B23");

  // Some sheets hand-type interest $ (B24) / points $ (B25) over the formula —
  // capture those as overrides so the recompute matches the sheet exactly.
  const iFormula = (offerPrice + flipRehabBudget) * ((flipInterestRate / 12) * flipHoldingMonths);
  const pFormula = offerPrice * flipPointsPct;
  const b24 = num(ws, "B24");
  const b25 = num(ws, "B25");
  const flipInterestOverride = raw(ws, "B24") != null && Math.abs(b24 - iFormula) > 1 ? b24 : null;
  const flipPointsOverride = raw(ws, "B25") != null && Math.abs(b25 - pFormula) > 1 ? b25 : null;

  const inputs: FlipInputs = {
    ...DEFAULT_FLIP_INPUTS,
    sqft: num(ws, "C5") || num(ws, "E5"), // sqft column drifts between sheets
    offerPrice,
    wholesalerFee: num(ws, "B10"),
    titleFeePct: pct(ws, "B11", 0.015),
    propertyTaxAnnual: num(ws, "E9"),
    insuranceAnnual: num(ws, "E10"),
    utilitiesAnnual: num(ws, "E11"),
    otherAnnual: num(ws, "E12"),
    commListingPct: pct(ws, "H9"),
    commBuyerPct: pct(ws, "H10"),
    buyerConcessions: num(ws, "H11"),
    commissionType,
    flipRehabBudget,
    rehabChoice,
    flipHoldingMonths,
    flipInterestRate,
    flipPointsPct,
    fluellenPct: numOr(ws, "B31", 1),
    partnerPct: num(ws, "B32"),
    flipComps,
    arvOverride: num(ws, "B20") || null, // manual Fix&Flip ARV
    flipInterestOverride,
    flipPointsOverride,
    wholetailRehabBudget: num(ws, "E17"),
    wholetailARV: num(ws, "E20"),
    wholetailHoldingMonths: numOr(ws, "E21", 3),
    wholetailInterestRate: pct(ws, "E22", 0.12),
    wholetailPointsPct: pct(ws, "E23"),
    rentalRehabBudget: num(ws, "H17"),
    rentalARV: num(ws, "H18"),
    rentMonthly: num(ws, "H20"),
    rentalInsuranceMonthly: num(ws, "H21"),
    rentalPropertyTaxAnnual: num(ws, "H22"),
    rentalLoanRate: pct(ws, "H28", 0.085),
    rentalAmortYears: numOr(ws, "H27", 30),
    ofRehabBudget: num(ws, "K17"),
    ofSalePrice: num(ws, "K18"),
    ofMarketValue: num(ws, "K19"),
    ofLoanRate: pct(ws, "K26", 0.085),
    ofAmortYears: numOr(ws, "K25", 30),
  };

  return {
    tabName,
    address: text(ws, "A5") || tabName,
    inputs,
    sheetProfit: typeof raw(ws, "B30") === "number" ? (raw(ws, "B30") as number) : null,
    sheetMaxOfferForProfit: typeof raw(ws, "B27") === "number" ? (raw(ws, "B27") as number) : null,
  };
}
