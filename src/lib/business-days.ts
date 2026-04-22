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

/** Subtract N CALENDAR days from a date (weekends + holidays count
 * normally). Use addBusinessDays() when you need to skip weekends. */
export function addCalendarDays(from: Date, n: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return d;
}

/** Normalize a state identifier to a 2-letter upper-case code, or
 * null if we can't confidently map it. Accepts "WY", "wy",
 * "Wyoming", "wyoming", "Cheyenne, WY", etc. */
export function normalizeStateCode(
  s: string | null | undefined,
): string | null {
  if (!s) return null;
  const t = s.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(t)) return t;
  // Check for ", XX" at end of a combined address/state string
  const trailing = t.match(/,\s*([A-Z]{2})\b/);
  if (trailing) return trailing[1];
  // Full state-name lookups (just the ones our user touches today;
  // easy to extend later)
  const NAMES: Record<string, string> = {
    WYOMING: "WY",
    COLORADO: "CO",
    MONTANA: "MT",
    NEBRASKA: "NE",
    "SOUTH DAKOTA": "SD",
    "NORTH DAKOTA": "ND",
    IDAHO: "ID",
    UTAH: "UT",
    MISSOURI: "MO",
    KANSAS: "KS",
    OKLAHOMA: "OK",
    TEXAS: "TX",
    ARIZONA: "AZ",
    "NEW MEXICO": "NM",
  };
  return NAMES[t] ?? null;
}

/**
 * State-specific default-rule registry.
 *
 * Wyoming: final walkthrough is typically scheduled 1 CALENDAR day
 * before closing. Other states can be added as we learn them.
 *
 * Returns the computed walkthrough date, OR null if the state has
 * no default rule (user fills in manually).
 */
export function defaultWalkthroughForState(
  closingDate: Date,
  stateCodeOrName: string | null | undefined,
): Date | null {
  const code = normalizeStateCode(stateCodeOrName);
  switch (code) {
    case "WY":
      // 1 calendar day before closing
      return addCalendarDays(closingDate, -1);
    // Extend here for other states as rules become clear:
    // case "MO": return addCalendarDays(closingDate, -2);
    default:
      return null;
  }
}
