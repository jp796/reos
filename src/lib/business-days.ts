/**
 * Business-day math for contract deadlines.
 *
 * "Business days" in US real estate contracts = Mon-Fri, excluding
 * federal holidays (optional — baseline here skips only weekends,
 * since most state forms say "business days" with no holiday carve-
 * out and the agent can manually override via the editable timeline).
 */

/** Add N business days (Mon-Fri) to a date. Returns a new Date at
 * the same hh:mm:ss as input, advanced to the Nth following weekday. */
export function addBusinessDays(from: Date, n: number): Date {
  if (n <= 0) return new Date(from);
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++; // skip Sun (0), Sat (6)
  }
  return d;
}

/** Snap a date forward to the next business day if it lands on a
 * weekend. Idempotent on weekdays. */
export function nextBusinessDay(d: Date): Date {
  const out = new Date(d);
  while (out.getDay() === 0 || out.getDay() === 6) {
    out.setDate(out.getDate() + 1);
  }
  return out;
}
