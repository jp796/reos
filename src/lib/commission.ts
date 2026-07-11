/**
 * Commission-percent canonical representation + formatting (remediation §9).
 *
 * CANONICAL: percentage-POINTS — `2.5` means 2.5%. The create/apply write
 * paths normalize to points. Some legacy rows were stored as decimal
 * fractions (`0.025`), which rendered as the wrong "0.025%". This module is
 * the ONE source of truth for reading + displaying a commission rate. It
 * converts obvious-decimal legacy rows to points **for display only** — it
 * NEVER rewrites stored data (§16.3: no silent reinterpretation on disk).
 *
 * Heuristic bounds: residential commissions realistically live in roughly
 * [0.5%, 10%]. A stored value below 0.5 is therefore almost certainly a
 * decimal fraction (0.005–0.10 → 0.5%–10%), not an implausible sub-0.5%
 * points value — so it is scaled ×100 for display. Values ≥ 0.5 are taken
 * as already-canonical points. (A genuine sub-0.5% points row is vanishingly
 * rare in residential RE; the data-repair migration handles true edge cases
 * under approval, not this display path.)
 */

/** Read a stored commission rate as canonical points (2.5 → 2.5). */
export function commissionRatePoints(
  raw: number | null | undefined,
): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return raw < 0.5 ? raw * 100 : raw;
}

/** Format a stored commission rate for display, e.g. "2.5%" / "—". */
export function formatCommissionPct(raw: number | null | undefined): string {
  const pts = commissionRatePoints(raw);
  if (pts == null) return "—";
  // Trim trailing zeros: 2.5% not 2.50%, 3% not 3.0%.
  return `${Number(pts.toFixed(3))}%`;
}

/** Plausibility bounds for validation on write (canonical points). */
export function isPlausibleCommissionPoints(points: number): boolean {
  return Number.isFinite(points) && points >= 0 && points <= 15;
}

/**
 * True when a stored (rate, amount, price) triple is INTERNALLY INCONSISTENT
 * — e.g. the amount doesn't match rate×price within tolerance. Used by the
 * audit report to FLAG rows for review, never to auto-correct (§9.5).
 */
export function commissionPairLooksInconsistent(opts: {
  ratePoints: number | null;
  amount: number | null;
  price: number | null;
}): boolean {
  const { ratePoints, amount, price } = opts;
  if (ratePoints == null || amount == null || price == null || price <= 0) return false;
  const expected = (ratePoints / 100) * price;
  if (expected <= 0) return false;
  const drift = Math.abs(expected - amount) / expected;
  return drift > 0.02; // >2% off = flag
}
