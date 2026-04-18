/**
 * Lightweight US street-address extractor + normalizer.
 *
 * Deliberately NOT trying to be a full USPS parser — just good enough to:
 *   - pull the address out of a title-order subject line
 *   - produce a stable key for matching against stored contact addresses
 *
 * If we ever need true parsing, swap the implementation for libpostal /
 * Smarty — the boundary here is the exported function shape, not the regex.
 *
 * Strategy:
 *   1. Find each street line (number + words + suffix).
 *   2. For each match, read forward to attach an optional city/state/zip tail.
 *   Two stages avoids the pitfall of a single greedy regex swallowing the
 *   state abbreviation into the city group.
 */

const STATE_LIST = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
].join("|");

const STREET_SUFFIX =
  "St|Street|Rd|Road|Dr|Drive|Ave|Avenue|Ln|Lane|Blvd|Boulevard|Ct|Court|" +
  "Pl|Place|Way|Ter|Terrace|Cir|Circle|Pkwy|Parkway|Hwy|Highway|Trl|Trail|" +
  "Loop|Run|Sq|Square";

const DIRECTIONAL = "N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest";

// Stage 1: find a street line.
//   "1420 E 19TH ST"
//   "301 Meadow St"
//   "1973 WEST FINLEY RIVER DR"
const STREET_RE = new RegExp(
  "\\b(\\d{1,6}\\s+" +
    `(?:(?:${DIRECTIONAL})\\.?\\s+)?` +
    "(?:[A-Za-z0-9'.-]+\\s+){0,4}" +
    "[A-Za-z0-9'.-]+\\s+" +
    `(?:${STREET_SUFFIX})\\.?)`,
  "gi",
);

// Stage 2: given the text immediately after a street, try to attach a tail.
// Accepts any of:   ", City, ST 12345"   ", City ST 12345"   " ST 12345"   ""
const TAIL_RE = new RegExp(
  "^[\\s,]*" +
    "(?:([A-Za-z][A-Za-z'.-]+(?:\\s+[A-Za-z][A-Za-z'.-]+){0,2}?)[\\s,]+)?" + // optional city (lazy)
    `(${STATE_LIST})\\b` +
    "(?:\\s+(\\d{5}(?:-\\d{4})?))?",
  "i",
);

// ==================================================
// TYPES
// ==================================================

export interface ParsedAddress {
  raw: string;
  street: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Stable uppercase key for matching — e.g. "123 MAIN ST|NIXA|MO|65714" */
  normalized: string;
}

// ==================================================
// PUBLIC API
// ==================================================

export function extractAddresses(text: string): ParsedAddress[] {
  if (!text) return [];

  const out: ParsedAddress[] = [];
  const seen = new Set<string>();

  STREET_RE.lastIndex = 0;
  for (const m of text.matchAll(STREET_RE)) {
    const street = m[1].trim();
    const startIdx = (m.index ?? 0) + m[0].length;
    const after = text.slice(startIdx, startIdx + 120);

    const tail = after.match(TAIL_RE);
    const city = tail?.[1]?.trim();
    const state = tail?.[2]?.trim().toUpperCase();
    const zip = tail?.[3]?.trim();

    const normalized = normalizeAddress({ street, city, state, zip });
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const rawParts = [street];
    if (city) rawParts.push(city);
    if (state) rawParts.push(state);
    if (zip) rawParts.push(zip);

    out.push({
      raw: rawParts.join(", "),
      street,
      city,
      state,
      zip,
      normalized,
    });
  }

  return out;
}

export function normalizeAddress(parts: {
  street: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const clean = (s: string | null | undefined) =>
    (s ?? "")
      .replace(/[,.#]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  return [
    clean(parts.street),
    clean(parts.city),
    clean(parts.state),
    clean(parts.zip),
  ]
    .filter(Boolean)
    .join("|");
}

export function addressToLabel(a: ParsedAddress): string {
  const parts = [a.street];
  if (a.city) parts.push(a.city);
  if (a.state) parts.push(a.state);
  return parts.join(", ").replace(/\s+/g, " ").trim();
}
