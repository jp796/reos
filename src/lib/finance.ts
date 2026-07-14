/**
 * Excel-compatible financial functions, ported for the Flip Calculator so the
 * native tool matches JP's spreadsheet to the penny.
 *
 * Sign conventions mirror Excel: PMT/PV/FV return the cash-flow sign Excel
 * would (payments are negative). The Flip model negates where the sheet does
 * (`*-1`) to present positive dollars.
 *
 * `type` = 0 → payments at period end (ordinary annuity); 1 → period start.
 */

/** Excel PMT — periodic payment for a loan. */
export function PMT(rate: number, nper: number, pv: number, fv = 0, type = 0): number {
  if (nper === 0) return 0;
  if (rate === 0) return -(pv + fv) / nper;
  const pow = Math.pow(1 + rate, nper);
  return (-(pv * pow + fv) * rate) / ((pow - 1) * (1 + rate * type));
}

/** Excel PV — present value of a stream of payments. */
export function PV(rate: number, nper: number, pmt: number, fv = 0, type = 0): number {
  if (rate === 0) return -(fv + pmt * nper);
  const pow = Math.pow(1 + rate, nper);
  return -(fv + pmt * (1 + rate * type) * ((pow - 1) / rate)) / pow;
}

/** Excel FV — future value of a stream of payments. */
export function FV(rate: number, nper: number, pmt: number, pv = 0, type = 0): number {
  if (rate === 0) return -(pv + pmt * nper);
  const pow = Math.pow(1 + rate, nper);
  return -(pv * pow + pmt * (1 + rate * type) * ((pow - 1) / rate));
}

/**
 * Excel CUMPRINC — cumulative principal paid between periods `start`..`end`
 * (inclusive, 1-based). Implemented per the Office spec: iterate the
 * amortization schedule, principal = payment − interest each period.
 */
export function CUMPRINC(
  rate: number,
  nper: number,
  pv: number,
  start: number,
  end: number,
  type = 0,
): number {
  if (rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < start) return 0;
  const pmt = PMT(rate, nper, pv, 0, type);
  let principal = 0;
  let balance = pv;
  for (let period = 1; period <= end; period++) {
    // Payment is negative (cash out); interest accrues positive.
    // Amortization: newBalance = balance + interest + pmt, so the principal
    // change each period is (pmt + interest) — a negative number that draws
    // the balance down.
    const interest = type === 1 && period === 1 ? 0 : balance * rate;
    const principalThisPeriod = pmt + interest;
    balance += principalThisPeriod;
    if (period >= start) principal += principalThisPeriod;
  }
  return principal;
}
