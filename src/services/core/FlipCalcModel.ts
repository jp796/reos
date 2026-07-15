/**
 * FlipCalcModel — a faithful port of JP's "BLANK TEMPLATE" flip-evaluation
 * spreadsheet. Pure function: inputs → the four scenario outputs
 * (Fix & Flip · Wholetail · DSCR Rental · Owner Finance) plus the rehab
 * estimator and comps→ARV engine.
 *
 * Every formula and default mirrors the source sheet so the native tool
 * produces identical numbers. Cell refs from the sheet are noted inline.
 */

import { PMT, PV, FV, CUMPRINC } from "@/lib/finance";

export type CommissionType = "Seller Agent" | "Referral Agent" | "None";
export type RehabChoice =
  | "Light Rehab Estimate"
  | "Medium Rehab Estimate"
  | "Big Rehab Estimate";

/** A single comparable sale used to derive $/sqft. */
export interface Comp {
  salePrice: number;
  sqft: number;
}

export interface FlipInputs {
  // Property
  sqft: number; // C5
  // Purchase & title
  offerPrice: number; // B9
  wholesalerFee: number; // B10
  titleFeePct: number; // B11 (0.015)
  // Annual carry costs
  propertyTaxAnnual: number; // E9
  insuranceAnnual: number; // E10
  utilitiesAnnual: number; // E11
  otherAnnual: number; // E12
  // Commissions & closing
  commListingPct: number; // H9 (0.025)
  commBuyerPct: number; // H10 (0.025)
  buyerConcessions: number; // H11
  commissionType: CommissionType; // H5
  // Fix & Flip
  flipRehabBudget: number; // B17
  rehabChoice: RehabChoice; // B18
  flipHoldingMonths: number; // B21 (6)
  flipInterestRate: number; // B22 (0.12)
  flipPointsPct: number; // B23
  fluellenPct: number; // B31 (1)
  partnerPct: number; // B32 (0)
  flipComps: Comp[]; // rows 42–46
  /** Manual Fix&Flip ARV (B20). When > 0 it overrides the comps-derived ARV —
   *  matches how the source sheets are filled (ARV typed in, comps left blank). */
  arvOverride?: number | null;
  /** Manual Fix&Flip interest $ (B24) / points $ (B25). When set, they override
   *  the computed formulas — some source sheets hand-type these. */
  flipInterestOverride?: number | null;
  flipPointsOverride?: number | null;
  // Wholetail
  wholetailRehabBudget: number; // E17
  wholetailARV: number; // E20 (manual)
  wholetailHoldingMonths: number; // E21 (3)
  wholetailInterestRate: number; // E22 (0.12)
  wholetailPointsPct: number; // E23
  // DSCR Rental
  rentalRehabBudget: number; // H17
  rentalARV: number; // H18 (manual)
  rentMonthly: number; // H20
  rentalInsuranceMonthly: number; // H21
  rentalPropertyTaxAnnual: number; // H22
  rentalLoanRate: number; // H28 (0.085)
  rentalAmortYears: number; // H27 (30)
  // Owner Finance
  ofRehabBudget: number; // K17
  ofSalePrice: number; // K18
  ofMarketValue: number; // K19
  ofLoanRate: number; // K26 (0.085)
  ofAmortYears: number; // K25 (30)
}

export const DEFAULT_FLIP_INPUTS: FlipInputs = {
  sqft: 0,
  offerPrice: 0,
  wholesalerFee: 0,
  titleFeePct: 0.015,
  propertyTaxAnnual: 2400,
  insuranceAnnual: 2400,
  utilitiesAnnual: 2400,
  otherAnnual: 0,
  commListingPct: 0.025,
  commBuyerPct: 0.025,
  buyerConcessions: 0,
  commissionType: "None",
  flipRehabBudget: 0,
  rehabChoice: "Medium Rehab Estimate",
  flipHoldingMonths: 6,
  flipInterestRate: 0.12,
  flipPointsPct: 0,
  fluellenPct: 1,
  partnerPct: 0,
  flipComps: [],
  wholetailRehabBudget: 0,
  wholetailARV: 0,
  wholetailHoldingMonths: 3,
  wholetailInterestRate: 0.12,
  wholetailPointsPct: 0,
  rentalRehabBudget: 0,
  rentalARV: 0,
  rentMonthly: 0,
  rentalInsuranceMonthly: 0,
  rentalPropertyTaxAnnual: 0,
  rentalLoanRate: 0.085,
  rentalAmortYears: 30,
  ofRehabBudget: 0,
  ofSalePrice: 0,
  ofMarketValue: 0,
  ofLoanRate: 0.085,
  ofAmortYears: 30,
};

export interface RehabEstimates {
  light: number; // K10
  medium: number; // K11
  big: number; // K12
  chosen: number; // B19 (by rehabChoice)
}

export interface CompsResult {
  rows: Array<{ salePrice: number; sqft: number; pricePerSqft: number }>;
  avgPricePerSqft: number; // D47
  avgSalePrice: number; // B47
  avgSqft: number; // C47
}

export interface FixFlipResult {
  arv: number; // B20
  interest: number; // B24
  points: number; // B25
  totalExpenses: number; // B26
  maxOfferForProfit: number; // B27 ($50k target)
  maxOffer70Ltv: number; // B28
  breakEvenOffer: number; // B29
  profit: number; // B30
  fluellen: number; // B33
  partner: number; // B34
  extraRealtor: number; // B35
}

export interface WholetailResult {
  arv: number; // E20
  interest: number; // E24
  points: number; // E25
  totalExpenses: number; // E26
  maxOfferForProfit: number; // E27 ($30k target)
  maxOffer70Ltv: number; // E28
  breakEvenOffer: number; // E29
  profit: number; // E30
  fluellen: number; // E33
  partner: number; // E34
  extraRealtor: number; // E35
}

export interface RentalResult {
  loanAmount: number; // H26
  monthlyPI: number; // H29
  monthlyExpenses: number; // H31
  monthlyCashflow: number; // H32
  annualDepreciation: number; // H33
  appreciation3yr: number; // H34
  principalPaydown3yr: number; // H35
  totalProfit3yr: number; // H36
  cocReturnAnnualized: number; // H37
  initialCashInDeal: number; // H30
}

export interface OwnerFinanceResult {
  downPayment: number; // K20
  buyerMortgageMonthly: number; // K21
  myLoanAmount: number; // K24
  myMonthlyPI: number; // K27
  monthlyExpenses: number; // K28
  monthlyCashflow: number; // K29
  initialCashProfit: number; // K31
  cashflowTotal3yr: number; // K32
  finalPayoffFromBuyer: number; // K33
  finalPayoffMyLoan: number; // K34
  finalPayoffProfit: number; // K35
  totalProfit3yr: number; // K36
}

export interface FlipResult {
  rehab: RehabEstimates;
  comps: CompsResult;
  closingCostsAuto: number; // H12
  fixFlip: FixFlipResult;
  wholetail: WholetailResult;
  rental: RentalResult;
  ownerFinance: OwnerFinanceResult;
}

function comps(list: Comp[], sqftFallback: number): CompsResult {
  const rows = list
    .filter((c) => c.salePrice > 0 && c.sqft > 0)
    .map((c) => ({ salePrice: c.salePrice, sqft: c.sqft, pricePerSqft: c.salePrice / c.sqft }));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  void sqftFallback;
  return {
    rows,
    avgPricePerSqft: avg(rows.map((r) => r.pricePerSqft)),
    avgSalePrice: avg(rows.map((r) => r.salePrice)),
    avgSqft: avg(rows.map((r) => r.sqft)),
  };
}

/** Compute the full flip evaluation from inputs — mirrors BLANK TEMPLATE. */
export function computeFlip(input: FlipInputs): FlipResult {
  const i = input;
  const carryAnnual = i.propertyTaxAnnual + i.insuranceAnnual + i.utilitiesAnnual + i.otherAnnual; // SUM(E9:E12)
  const commTotalPct = i.commListingPct + i.commBuyerPct; // H9+H10
  const closingCostsAuto = i.offerPrice * i.titleFeePct; // H12

  const rehab: RehabEstimates = {
    light: i.sqft * 20, // K10
    medium: i.sqft * 35, // K11
    big: i.sqft * 50, // K12
    chosen:
      i.rehabChoice === "Big Rehab Estimate"
        ? i.sqft * 50
        : i.rehabChoice === "Light Rehab Estimate"
          ? i.sqft * 20
          : i.sqft * 35, // B19
  };

  const compsResult = comps(i.flipComps, i.sqft);

  // ---- FIX & FLIP ----
  // B20: manual ARV wins when supplied; else derive from comps (C5*D47).
  const ffArv =
    i.arvOverride != null && i.arvOverride > 0
      ? i.arvOverride
      : i.sqft * compsResult.avgPricePerSqft;
  const ffInterest =
    i.flipInterestOverride != null
      ? i.flipInterestOverride
      : (i.offerPrice + i.flipRehabBudget) * ((i.flipInterestRate / 12) * i.flipHoldingMonths); // B24
  const ffPoints = i.flipPointsOverride != null ? i.flipPointsOverride : i.offerPrice * i.flipPointsPct; // B25
  const ffTotalExpenses =
    i.offerPrice +
    i.flipRehabBudget +
    ffInterest +
    ffPoints +
    closingCostsAuto +
    ffArv * commTotalPct +
    (carryAnnual / 12) * i.flipHoldingMonths; // B26
  const ffProfit = ffArv - ffTotalExpenses; // B30
  const extraRealtor = (arv: number) =>
    i.commissionType === "Seller Agent"
      ? arv * i.commListingPct
      : i.commissionType === "Referral Agent"
        ? (arv * i.commListingPct) / 3
        : 0;
  const fixFlip: FixFlipResult = {
    arv: ffArv,
    interest: ffInterest,
    points: ffPoints,
    totalExpenses: ffTotalExpenses,
    maxOfferForProfit: ffArv - (ffTotalExpenses - i.offerPrice) - 50000, // B27
    maxOffer70Ltv: ffArv * 0.7 - i.flipRehabBudget, // B28
    breakEvenOffer: ffArv - ffTotalExpenses + i.offerPrice, // B29
    profit: ffProfit,
    fluellen: ffProfit * i.fluellenPct, // B33
    partner: ffProfit * i.partnerPct, // B34
    extraRealtor: extraRealtor(ffArv), // B35
  };

  // ---- WHOLETAIL ----
  const wtArv = i.wholetailARV; // E20 (manual)
  const wtInterest = i.offerPrice * ((i.wholetailInterestRate / 12) * i.wholetailHoldingMonths); // E24
  const wtPoints = i.offerPrice * i.wholetailPointsPct; // E25
  const wtTotalExpenses =
    i.offerPrice +
    i.wholetailRehabBudget +
    wtInterest +
    wtPoints +
    closingCostsAuto +
    wtArv * commTotalPct +
    (carryAnnual / 12) * i.wholetailHoldingMonths; // E26
  const wtProfit = wtArv - wtTotalExpenses; // E30
  const wholetail: WholetailResult = {
    arv: wtArv,
    interest: wtInterest,
    points: wtPoints,
    totalExpenses: wtTotalExpenses,
    maxOfferForProfit: wtArv - (wtTotalExpenses - i.offerPrice) - 30000, // E27
    maxOffer70Ltv: wtArv * 0.7 - i.wholetailRehabBudget, // E28
    breakEvenOffer: wtArv - wtTotalExpenses + i.offerPrice, // E29
    profit: wtProfit,
    fluellen: wtProfit * i.fluellenPct, // E33
    partner: wtProfit * i.partnerPct, // E34
    extraRealtor: extraRealtor(wtArv), // E35
  };

  // ---- DSCR RENTAL ----
  const rLoan = i.rentalARV * 0.7; // H26
  const rVacancyRate = 1 / 12; // H19
  const rPI = rLoan > 0 ? PMT(i.rentalLoanRate / 12, i.rentalAmortYears * 12, rLoan, 0, 1) * -1 : 0; // H29
  const rMonthlyExpenses =
    i.rentalInsuranceMonthly +
    i.rentalPropertyTaxAnnual / 12 +
    i.rentMonthly * 0.08 + // PM 8% (H23)
    i.rentMonthly * rVacancyRate + // vacancy (H24)
    i.rentMonthly * 0.1 + // maint/capex 10% (H25)
    rPI; // H31
  const rMonthlyCashflow = i.rentMonthly - rMonthlyExpenses; // H32
  const rInitialCash = rLoan - i.offerPrice - i.rentalRehabBudget; // H30
  const rAnnualDeprec = (i.offerPrice + i.rentalRehabBudget) / 27.5; // H33
  const rAppreciation3yr = i.rentalARV > 0 ? FV(0.03, 3, 0, i.rentalARV, 0) * -1 - i.rentalARV : 0; // H34
  let rPaydown3yr = 0; // H35
  try {
    rPaydown3yr = CUMPRINC(i.rentalLoanRate / 12, i.rentalAmortYears * 12, rLoan, 1, 36, 0) * -1;
    if (!Number.isFinite(rPaydown3yr)) rPaydown3yr = 0;
  } catch {
    rPaydown3yr = 0;
  }
  const rTotalProfit3yr = rMonthlyCashflow * 36 + rAnnualDeprec * 3 + rAppreciation3yr + rPaydown3yr; // H36
  const rental: RentalResult = {
    loanAmount: rLoan,
    monthlyPI: rPI,
    monthlyExpenses: rMonthlyExpenses,
    monthlyCashflow: rMonthlyCashflow,
    annualDepreciation: rAnnualDeprec,
    appreciation3yr: rAppreciation3yr,
    principalPaydown3yr: rPaydown3yr,
    totalProfit3yr: rTotalProfit3yr,
    cocReturnAnnualized: rInitialCash !== 0 ? rTotalProfit3yr / rInitialCash / 3 : 0, // H37
    initialCashInDeal: rInitialCash,
  };

  // ---- OWNER FINANCE ----
  const ofDown = i.ofMarketValue * 0.2; // K20
  const ofBuyerMortgage = i.ofMarketValue > 0 ? PMT(0.12 / 12, 360, i.ofMarketValue - ofDown, 0, 1) * -1 : 0; // K21
  const ofMyLoan = i.ofMarketValue * 0.7; // K24
  const ofMyPI = ofMyLoan > 0 ? PMT(i.ofLoanRate / 12, i.ofAmortYears * 12, ofMyLoan, 0, 1) * -1 : 0; // K27
  const ofMonthlyExpenses = ofMyPI + i.rentalInsuranceMonthly + i.rentalPropertyTaxAnnual / 12; // K28 (K22=H21, K23=H22)
  const ofMonthlyCashflow = ofBuyerMortgage - ofMonthlyExpenses; // K29
  const ofInitialCashProfit = (i.offerPrice + i.ofRehabBudget - ofMyLoan - ofDown) * -1; // K31
  const ofCashflowTotal3yr = ofMonthlyCashflow * 36; // K32
  const ofPayoffFromBuyer = ofMyPI > 0 ? PV(i.ofLoanRate / 12, 360 - 36, ofMyPI, 0) * -1 : 0; // K33
  const ofPayoffMyLoan = ofMyPI > 0 ? PV(0.12 / 12, 360 - 36, ofMyPI, 0) * -1 : 0; // K34
  const ofPayoffProfit = ofPayoffFromBuyer - ofPayoffMyLoan; // K35
  const ownerFinance: OwnerFinanceResult = {
    downPayment: ofDown,
    buyerMortgageMonthly: ofBuyerMortgage,
    myLoanAmount: ofMyLoan,
    myMonthlyPI: ofMyPI,
    monthlyExpenses: ofMonthlyExpenses,
    monthlyCashflow: ofMonthlyCashflow,
    initialCashProfit: ofInitialCashProfit,
    cashflowTotal3yr: ofCashflowTotal3yr,
    finalPayoffFromBuyer: ofPayoffFromBuyer,
    finalPayoffMyLoan: ofPayoffMyLoan,
    finalPayoffProfit: ofPayoffProfit,
    totalProfit3yr: ofInitialCashProfit + ofCashflowTotal3yr + ofPayoffProfit, // K36
  };

  return { rehab, comps: compsResult, closingCostsAuto, fixFlip, wholetail, rental, ownerFinance };
}
