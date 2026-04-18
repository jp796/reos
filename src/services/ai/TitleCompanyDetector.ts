/**
 * TitleCompanyDetector
 *
 * Classifies whether an email came from a title / escrow / settlement company.
 * Rule-based first — free, fast, no external call. When confidence is
 * ambiguous, the caller can escalate to an AI classifier.
 *
 * Designed so each "reason" contributes a score; final confidence is
 * min(1, sum). Anything >= 0.7 is considered a match for auto-action.
 */

// ==================================================
// CONFIG
// ==================================================

/**
 * Known title-company sending domains seeded from real inbound emails.
 * Add to this list as new title companies are encountered.
 * Matching is case-insensitive and also matches subdomains, so
 *   "hogantitle.ccsend.com"  matches  foo@hogantitle.ccsend.com
 *   "firstam.com"             matches  closer@firstam.com  AND  closer@team.firstam.com
 */
export const KNOWN_TITLE_DOMAINS: readonly string[] = [
  "fste.com",
  "firstam.com",
  "mtc.llc",
  "tsqtitle.com",
  "hogantitle.ccsend.com",
];

/**
 * Substrings that strongly indicate a title/escrow/settlement domain.
 * Applied against the sender domain only.
 */
const DOMAIN_SIGNAL_SUBSTRINGS: readonly string[] = [
  "title",
  "escrow",
  "settlement",
  "closings",
];

/**
 * Role terms that commonly appear in title-company display names /
 * signature blocks. Detected in the sender's display name and the
 * message body.
 */
const ROLE_KEYWORDS: readonly string[] = [
  "closer",
  "closing officer",
  "escrow officer",
  "escrow coordinator",
  "title officer",
  "title agent",
  "settlement agent",
  "transaction coordinator",
];

/**
 * Body / subject phrases typical of title-order communications.
 */
const BODY_KEYWORDS: readonly string[] = [
  "title order",
  "title commitment",
  "commitment for title insurance",
  "earnest money",
  "closing disclosure",
  "settlement statement",
  "closing package",
  "wiring instructions",
  "wire instructions",
  "file number",
  "order number",
  "escrow number",
];

/**
 * Attachment filename hints.
 */
const ATTACHMENT_PATTERNS: readonly RegExp[] = [
  /title[_\s-]*commitment/i,
  /title[_\s-]*order/i,
  /closing[_\s-]*disclosure/i,
  /settlement[_\s-]*statement/i,
  /\bcd\b.*\.pdf$/i,
  /escrow.*instructions/i,
  /wire.*instructions/i,
];

// ==================================================
// TYPES
// ==================================================

export interface EmailForDetection {
  /** "Jane Smith" (display name portion of From header) */
  fromName?: string | null;
  /** "jane@firstam.com" (email portion of From header) */
  fromEmail?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  attachmentFilenames?: readonly string[];
}

export interface DetectionResult {
  isTitleCompany: boolean;
  confidence: number; // 0–1
  reasons: string[];
  matchedDomain?: string;
}

// ==================================================
// MAIN DETECTOR
// ==================================================

/**
 * Scores an email for "is this from a title company?"
 * Pure function — no I/O, safe to call per-message.
 *
 * Scoring: identity signals (who sent) + transactional signals (what about).
 * Domain match alone cannot cross the auto-apply threshold — there must be
 * at least one transactional signal (attachment, body keyword, or a property
 * address extracted from subject/body). This prevents promotional/marketing
 * emails from a known title-company domain from triggering disposition.
 */
export function detectTitleCompanyEmail(
  email: EmailForDetection,
): DetectionResult {
  let score = 0;
  const reasons: string[] = [];
  let matchedDomain: string | undefined;

  const fromEmail = (email.fromEmail ?? "").trim().toLowerCase();
  const fromName = (email.fromName ?? "").trim().toLowerCase();
  const subject = (email.subject ?? "").toLowerCase();
  const body = (email.bodyText ?? "").toLowerCase();
  const filenames = (email.attachmentFilenames ?? []).map((f) =>
    f.toLowerCase(),
  );

  // Track transactional signal score separately. Cap fires unless
  // transactional evidence >= 0.2, which prevents a single weak body
  // keyword ("earnest money" in a marketing footer, for example) from
  // unlocking auto-apply on domain match alone.
  let transactionalScore = 0;

  // --- IDENTITY SIGNALS ---

  // 1. Known domain match (heaviest signal: +0.7)
  if (fromEmail) {
    const senderDomain = extractDomain(fromEmail);
    if (senderDomain) {
      for (const known of KNOWN_TITLE_DOMAINS) {
        const k = known.toLowerCase();
        if (senderDomain === k || senderDomain.endsWith(`.${k}`)) {
          score += 0.7;
          matchedDomain = k;
          reasons.push(`known-title-domain:${k}`);
          break;
        }
      }
    }

    // 2. Domain contains title/escrow/settlement substring (+0.35)
    if (!matchedDomain && senderDomain) {
      for (const sig of DOMAIN_SIGNAL_SUBSTRINGS) {
        if (senderDomain.includes(sig)) {
          score += 0.35;
          reasons.push(`domain-keyword:${sig}`);
          break;
        }
      }
    }
  }

  // 3. Role keyword in sender display name (+0.2)
  if (fromName) {
    for (const role of ROLE_KEYWORDS) {
      if (fromName.includes(role)) {
        score += 0.2;
        reasons.push(`from-name-role:${role}`);
        break;
      }
    }
  }

  // --- TRANSACTIONAL SIGNALS ---

  // 4. Body / subject keywords (+0.1 each, capped at +0.3)
  let bodyHits = 0;
  for (const kw of BODY_KEYWORDS) {
    if (subject.includes(kw) || body.includes(kw)) {
      bodyHits++;
      reasons.push(`body-keyword:${kw}`);
      if (bodyHits >= 3) break;
    }
  }
  const bodyScore = Math.min(bodyHits * 0.1, 0.3);
  score += bodyScore;
  transactionalScore += bodyScore;

  // 5. Attachment pattern (+0.25)
  for (const pat of ATTACHMENT_PATTERNS) {
    if (filenames.some((f) => pat.test(f))) {
      score += 0.25;
      transactionalScore += 0.25;
      reasons.push(`attachment-pattern:${pat.source}`);
      break;
    }
  }

  // 6. Subject contains a street address (+0.2) — strong transactional signal
  if (/\b\d{1,6}\s+[A-Za-z0-9'.-]+(?:\s+[A-Za-z0-9'.-]+){0,4}\s+(?:St|Street|Rd|Road|Dr|Drive|Ave|Avenue|Ln|Lane|Blvd|Boulevard|Ct|Court|Pl|Place|Way|Ter|Terrace|Cir|Circle|Pkwy|Parkway|Hwy|Highway|Trl|Trail|Loop|Run|Sq|Square)\.?/i.test(
    email.subject ?? "",
  )) {
    score += 0.2;
    transactionalScore += 0.2;
    reasons.push("subject-contains-address");
  }

  // 7. Subject / body contains order / file / escrow number (+0.2)
  if (
    /(?:order|file|escrow)\s*(?:#|number|no\.?)\s*[:\s-]\s*\w+/i.test(
      (email.subject ?? "") + " " + (email.bodyText ?? ""),
    )
  ) {
    score += 0.2;
    transactionalScore += 0.2;
    reasons.push("order-number-reference");
  }

  // --- HARD CAP: identity alone isn't enough ---
  // Require transactional evidence of at least 0.2 (≈ an attachment, address,
  // order number, or 2+ body keywords). A single "earnest money" mention in
  // marketing copy is only 0.1 — NOT enough to auto-apply.
  const AUTO_APPLY_THRESHOLD = 0.7;
  const MIN_TRANSACTIONAL_SCORE = 0.2;
  if (transactionalScore < MIN_TRANSACTIONAL_SCORE && score >= AUTO_APPLY_THRESHOLD) {
    score = 0.65;
    reasons.push(`capped:weak-transactional-signal(${transactionalScore.toFixed(2)})`);
  }

  score = Math.min(score, 1);
  return {
    isTitleCompany: score >= AUTO_APPLY_THRESHOLD,
    confidence: score,
    reasons,
    matchedDomain,
  };
}

/**
 * "john.smith@mail.firstam.com"  →  "mail.firstam.com"
 * Returns undefined for malformed inputs.
 */
function extractDomain(email: string): string | undefined {
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1) return undefined;
  return email.slice(at + 1).toLowerCase().trim();
}
