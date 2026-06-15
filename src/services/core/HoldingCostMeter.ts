/**
 * HoldingCostMeter — daily holding-cost accrual for `takes_title` assets
 * (spec §7). Interest, taxes, insurance, utilities, and other carry
 * accrue per day from acquisition and feed the profit projection (flip
 * allInCost.holdingCosts, BRRRR holding). Pure + deterministic.
 *
 * Monthly inputs are converted to a daily rate using the average days
 * per month (365.25 / 12 = 30.4375) so a partial month accrues fairly.
 */

const AVG_DAYS_PER_MONTH = 30.4375;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface HoldingCostInput {
  /** Acquisition / start-of-carry date. */
  startDate: Date;
  /** Defaults to now. The day the meter is read or carry stopped (sale). */
  asOf?: Date;
  monthlyInterest?: number | null;
  monthlyTaxes?: number | null;
  monthlyInsurance?: number | null;
  monthlyUtilities?: number | null;
  monthlyOther?: number | null;
}

export interface HoldingCostResult {
  daysHeld: number;
  dailyRate: number;
  accrued: number;
  breakdown: {
    interest: number;
    taxes: number;
    insurance: number;
    utilities: number;
    other: number;
  };
}

/** True for the title paths that own the asset and therefore carry it. */
export function carriesHoldingCost(titlePath: string | null | undefined): boolean {
  return titlePath === "takes_title";
}

export function computeHoldingCost(input: HoldingCostInput): HoldingCostResult {
  const asOf = input.asOf ?? new Date();
  const ms = asOf.getTime() - input.startDate.getTime();
  const daysHeld = Math.max(0, Math.floor(ms / 86_400_000));

  const monthly = {
    interest: input.monthlyInterest ?? 0,
    taxes: input.monthlyTaxes ?? 0,
    insurance: input.monthlyInsurance ?? 0,
    utilities: input.monthlyUtilities ?? 0,
    other: input.monthlyOther ?? 0,
  };
  const toAccrued = (m: number) => r2((m / AVG_DAYS_PER_MONTH) * daysHeld);
  const breakdown = {
    interest: toAccrued(monthly.interest),
    taxes: toAccrued(monthly.taxes),
    insurance: toAccrued(monthly.insurance),
    utilities: toAccrued(monthly.utilities),
    other: toAccrued(monthly.other),
  };
  const monthlyTotal =
    monthly.interest +
    monthly.taxes +
    monthly.insurance +
    monthly.utilities +
    monthly.other;
  const dailyRate = r2(monthlyTotal / AVG_DAYS_PER_MONTH);
  const accrued = r2(
    breakdown.interest +
      breakdown.taxes +
      breakdown.insurance +
      breakdown.utilities +
      breakdown.other,
  );
  return { daysHeld, dailyRate, accrued, breakdown };
}
