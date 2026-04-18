/**
 * Parse structured fields from title-company email subjects.
 *
 * firstam.com and similar vendors use a dashed-field format:
 *   "Commission Confirmation for File Number-4360385-Address-4808 Rock
 *    Springs Street-Buyer-Judy Gebhard-Seller-Derek J. and Korin A. Schmidt
 *    Joint Revocable Trust (Email Ref=2600709827)"
 *
 * We pull Buyer, Seller, File Number (and leave Address to address-parser).
 * Names extracted here are used for contact matching when participant
 * emails and addresses don't reach the real client.
 */

export interface SubjectParties {
  buyer?: string;
  seller?: string;
  fileNumber?: string;
}

/**
 * Field keywords that act as delimiters in the "Key-Value-Key-Value" format.
 * Order doesn't matter; the regex treats them as stop tokens.
 */
const FIELD_STOP = "(?:Buyer|Seller|File|Address|Email\\s*Ref)";

export function parseSubjectParties(subject: string): SubjectParties {
  if (!subject) return {};
  const out: SubjectParties = {};

  // Buyer-<name>  — stops at next field keyword, open paren, or end
  const buyer = new RegExp(
    `\\bBuyer-(.+?)(?=-${FIELD_STOP}\\b|\\s*\\(|$)`,
    "i",
  ).exec(subject);
  if (buyer?.[1]) out.buyer = buyer[1].trim();

  // Seller-<name>
  const seller = new RegExp(
    `\\bSeller-(.+?)(?=-${FIELD_STOP}\\b|\\s*\\(|$)`,
    "i",
  ).exec(subject);
  if (seller?.[1]) out.seller = seller[1].trim();

  // File Number-<id>   or   File #-<id>   or  File: <id>
  // File numbers are digits optionally split by dashes (4360385, 24-0987).
  // Restricting to \d keeps us from swallowing "-Address" after the id.
  const fileNum = /\bFile(?:\s*Number|\s*#|\s*No\.?)?[:\s-]\s*(\d+(?:-\d+)*)/i.exec(
    subject,
  );
  if (fileNum?.[1]) out.fileNumber = fileNum[1].trim();

  return out;
}

/**
 * Produce progressively looser variants of a name for DB matching.
 * Strips entity suffixes (LLC, Trust, Joint Revocable Trust, etc.) and
 * compound constructs ("and X and Y") so "Derek J. and Korin A. Schmidt
 * Joint Revocable Trust" becomes matchable to a contact like
 * "Derek Schmidt" or "Korin Schmidt".
 */
export function nameVariants(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const variants = new Set<string>();
  variants.add(trimmed);

  // Strip common entity suffixes
  const suffixRe =
    /\s+(?:Joint\s+Revocable\s+Trust|Revocable\s+Trust|Family\s+Trust|Trust|LLC|Inc|Incorporated|LP|LLP|Co|Corp|Corporation|Estate)\b.*$/i;
  const withoutSuffix = trimmed.replace(suffixRe, "").trim();
  if (withoutSuffix && withoutSuffix !== trimmed) variants.add(withoutSuffix);

  // Split on "and" to handle joint ownership ("Derek J. and Korin A. Schmidt")
  const andMatch = withoutSuffix.split(/\s+and\s+/i);
  if (andMatch.length > 1) {
    // Last piece usually contains the shared last name
    const lastPart = andMatch[andMatch.length - 1].trim();
    const lastParts = lastPart.split(/\s+/);
    const lastName = lastParts[lastParts.length - 1];
    for (let i = 0; i < andMatch.length; i++) {
      const piece = andMatch[i].trim();
      const pieceParts = piece.split(/\s+/);
      // If the piece doesn't already include the last name, append it
      if (lastName && !piece.toLowerCase().includes(lastName.toLowerCase())) {
        variants.add(`${piece} ${lastName}`);
        // Also try first-word + last-name (drop middle initials)
        variants.add(`${pieceParts[0]} ${lastName}`);
      } else {
        variants.add(piece);
        variants.add(`${pieceParts[0]} ${pieceParts[pieceParts.length - 1]}`);
      }
    }
  } else {
    // Single name — also produce first+last without initials
    const parts = withoutSuffix.split(/\s+/).filter((p) => !/^[A-Z]\.?$/.test(p));
    if (parts.length >= 2) {
      variants.add(`${parts[0]} ${parts[parts.length - 1]}`);
    }
  }

  // Drop variants shorter than 4 chars
  return Array.from(variants).filter((v) => v.length >= 4);
}
