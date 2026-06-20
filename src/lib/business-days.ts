/**
 * Business-day math for contract deadlines.
 *
 * "Business days" = Mon-Fri, excluding US federal holidays (observed).
 * Brokers and title offices are closed on federal holidays, so a
 * deadline that would land on (or be counted through) a holiday skips
 * it. The agent can still override any date via the editable timeline.
 */

// ── US federal holidays (observed) ─────────────────────────────────
const holidayCache = new Map<number, Set<string>>();

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Nth (1-based) `weekday` (0=Sun) of `month` (0-based) in `year`. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0); // last day of month
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}
/** Saturday holiday → observed Friday; Sunday → observed Monday. */
function observed(d: Date): Date {
  const day = d.getDay();
  if (day === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  if (day === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d;
}

function federalHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const dates: Date[] = [
    observed(new Date(year, 0, 1)), // New Year's Day
    nthWeekday(year, 0, 1, 3), // MLK Jr Day — 3rd Mon Jan
    nthWeekday(year, 1, 1, 3), // Presidents Day — 3rd Mon Feb
    lastWeekday(year, 4, 1), // Memorial Day — last Mon May
    observed(new Date(year, 5, 19)), // Juneteenth
    observed(new Date(year, 6, 4)), // Independence Day
    nthWeekday(year, 8, 1, 1), // Labor Day — 1st Mon Sep
    nthWeekday(year, 9, 1, 2), // Columbus Day — 2nd Mon Oct
    observed(new Date(year, 10, 11)), // Veterans Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving — 4th Thu Nov
    observed(new Date(year, 11, 25)), // Christmas
  ];
  const set = new Set(dates.map(ymd));
  holidayCache.set(year, set);
  return set;
}

/** True if `d` is a US federal holiday (observed). */
export function isFederalHoliday(d: Date): boolean {
  return federalHolidays(d.getFullYear()).has(ymd(d));
}

/** True if `d` is a non-working day (weekend or federal holiday). */
function isNonBusinessDay(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6 || isFederalHoliday(d);
}

/** Add N business days (Mon-Fri, skipping federal holidays). Returns a
 * new Date at the same hh:mm:ss as input. */
export function addBusinessDays(from: Date, n: number): Date {
  if (n <= 0) return new Date(from);
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (!isNonBusinessDay(d)) added++;
  }
  return d;
}

/** Snap a date forward to the next business day if it lands on a
 * weekend or federal holiday. Idempotent on business days. */
export function nextBusinessDay(d: Date): Date {
  const out = new Date(d);
  while (isNonBusinessDay(out)) {
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
