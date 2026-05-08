/**
 * Timezone-safe date helpers.
 *
 * Why this exists:
 *   `new Date("2026-05-19")` parses as UTC midnight per ECMA-262.
 *   Stored as `2026-05-19T00:00:00.000Z`, displayed via
 *   `toLocaleDateString()` in any negative-offset timezone (every
 *   US zone), it renders as "May 18" — off by one day.
 *
 *   The fix: date-only fields (closing date, inspection deadline,
 *   list date, etc.) are stored as LOCAL NOON. Local noon survives
 *   timezone math anywhere within ±11 hours of UTC, so the visible
 *   date is the same as what the user typed, on every continent.
 *
 * Use these helpers anywhere a `<input type="date">` value flows
 * into the DB, or anywhere a stored date-only Date is rendered.
 */

/**
 * Parse a date input string into a Date that survives timezone math.
 *
 *  - "2026-05-19"             → local noon on May 19
 *  - "2026-05-19T10:30"       → local datetime as-is (datetime-local input)
 *  - any other ISO string     → `new Date(s)` (already typed)
 *  - null / "" / non-string   → null
 *
 * Use on the SERVER right before persisting, so the DB always
 * holds a Date that displays as the same day everywhere.
 */
export function parseInputDate(s: unknown): Date | null {
  if (typeof s !== "string" || s.length === 0) return null;
  // Bare YYYY-MM-DD (HTML date input) — treat as local noon
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Format a stored Date as a date-only display string.
 *
 *  - Local-noon Dates round-trip cleanly via `toLocaleDateString`.
 *  - Legacy UTC-midnight Dates (saved before this fix) get
 *    re-interpreted: if the time component is exactly 00:00:00 UTC,
 *    we shift by +12h to align with the rest of the system.
 *
 * Returns "—" for null/undefined.
 */
export function fmtLocalDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  // Legacy compatibility: if it's UTC-midnight, treat as a date-only
  // value and bump to local-noon equivalent.
  const isMidnightUtc =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0;
  const shown = isMidnightUtc
    ? new Date(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        12,
      )
    : date;
  return shown.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a Date for the value of an <input type="date"> — always
 * the YYYY-MM-DD that matches what the user would see. */
export function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  // Legacy UTC-midnight handling matches fmtLocalDate
  const y =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0
      ? date.getUTCFullYear()
      : date.getFullYear();
  const m =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0
      ? date.getUTCMonth() + 1
      : date.getMonth() + 1;
  const dd =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0
      ? date.getUTCDate()
      : date.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Format a Date for the value of an <input type="datetime-local">. */
export function toDateTimeInputValue(
  d: Date | string | null | undefined,
): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const tz = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tz).toISOString().slice(0, 16);
}
