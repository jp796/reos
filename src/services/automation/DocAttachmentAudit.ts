/**
 * DocAttachmentAudit — classify an already-attached Document as LIKELY-CORRECT,
 * LIKELY-MIS-ATTACHED, or REVIEW, using the same signals as the ingest fix
 * (caba512 + the principal-sender improvement).
 *
 * Purpose: clean up the pre-fix mess where Gmail auto-attach matched emails by
 * SENDER ALONE (a shared title-co / co-agent working many deals dumped OTHER
 * properties' attachments onto a deal) and ingested email-signature images as
 * "documents". This is the READ-ONLY classifier; the audit script prints its
 * verdict per document so a human approves the delete list before anything is
 * removed.
 *
 * Everything here is DB-only and pure (no Gmail calls), keyed on the fields
 * REOS already records:
 *   - source        upload | gmail_attachment | fub_attachment
 *   - uploadOrigin  "ingest:<signal>" for auto-attached docs; the <signal> is
 *                   how the ingest matched the email to the deal:
 *                     address          → property address was in the email  (trusted)
 *                     sender_principal → this deal's buyer/seller, exclusive (trusted)
 *                     sender_email     → OLD sender-only rule (the bug)      (suspect)
 *                     sender_vendor    → shared vendor on the sender alone   (suspect)
 *                     party_name       → weak name match                    (review)
 *   - mimeType / fileName  image types & non-document extensions = signature junk
 *
 * NOTE: the sender's email address is not stored on Document (only the Gmail
 * message id, inside sourceRef). The <signal> in uploadOrigin already tells us
 * HOW it matched — which is what determines trust — so sender enrichment via a
 * Gmail read is optional and not needed to flag the mess.
 */

import { addrKey } from "./DealEmailMatcher";

export type AuditVerdict = "LIKELY-CORRECT" | "LIKELY-MIS-ATTACHED" | "REVIEW";

export interface AuditDocInput {
  fileName: string;
  mimeType: string;
  /** upload | gmail_attachment | fub_attachment */
  source: string;
  uploadOrigin: string | null;
}

export interface AuditOpts {
  /** The deal's property address. When given, a sender-only doc whose filename
   *  names THIS property is softened to REVIEW (likely a real doc of this deal),
   *  instead of being flagged outright — so the report doesn't tell you to
   *  delete "Roof Cert - 3216 Land Ct.pdf". */
  dealAddress?: string | null;
}

/** True when the deal's street number appears in the filename (e.g. deal
 *  "3216 Land Ct" and file "Roof Cert - 3216 Land Ct.pdf"). Cheap, no zip. */
export function filenameReferencesDeal(fileName: string, dealAddress: string | null | undefined): boolean {
  if (!dealAddress) return false;
  const streetNum = addrKey(dealAddress).streetNum;
  if (!streetNum) return false;
  const nums: string[] = fileName.match(/\d{1,6}/g) ?? [];
  return nums.includes(streetNum);
}

export interface AuditResult {
  verdict: AuditVerdict;
  /** The ingest match signal parsed from uploadOrigin, or null. */
  signal: string | null;
  reasons: string[];
}

/** Real transaction documents. Matches the ingest DOC_EXT gate. */
const DOC_EXT = /\.(pdf|docx?)$/i;
/** Signature logos, inline graphics, calendar invites, cert blobs — never a deal doc. */
const JUNK_EXT = /\.(png|jpe?g|gif|tiff?|bmp|svg|heic|webp|ics|vcf|p7s|p7m|eml|asc)$/i;
/** Filenames that scream "email signature / inline image", not a document. */
const JUNK_NAME = /^(image[-_ ]?0*\d+|icon|logo|signature|sig|banner|footer|header|avatar|spacer|divider)\b/i;

/** Parse "ingest:<signal>" → "<signal>"; anything else → null. */
export function parseIngestSignal(uploadOrigin: string | null): string | null {
  if (!uploadOrigin) return null;
  return uploadOrigin.startsWith("ingest:") ? uploadOrigin.slice("ingest:".length) : null;
}

/**
 * Classify one attached document. Pure — safe to unit test and to run in a
 * read-only audit.
 */
export function classifyDocument(doc: AuditDocInput, opts: AuditOpts = {}): AuditResult {
  const signal = parseIngestSignal(doc.uploadOrigin);
  const isImageMime = doc.mimeType.toLowerCase().startsWith("image/");
  const isJunkExt = JUNK_EXT.test(doc.fileName) && !DOC_EXT.test(doc.fileName);
  const isJunkName = JUNK_NAME.test(doc.fileName.trim());
  const fromGmail = doc.source === "gmail_attachment";
  const namesThisDeal = filenameReferencesDeal(doc.fileName, opts.dealAddress);
  // When a sender-only / weak / unknown attach names THIS property, it's very
  // likely a real doc of this deal that just happened to arrive via the buggy
  // rule — soften to REVIEW (keep-leaning) rather than flag it for deletion.
  const softenReason = ` — BUT the filename references this property, so it's likely a real doc of this deal; verify before deleting`;

  // A file a human put there on purpose (manual upload or the FUB deal record)
  // is trusted regardless of type — the user chose it.
  if (doc.source === "upload") {
    return { verdict: "LIKELY-CORRECT", signal, reasons: ["manually uploaded by a user"] };
  }
  if (doc.source === "fub_attachment") {
    return { verdict: "LIKELY-CORRECT", signal, reasons: ["came from the Follow Up Boss deal record"] };
  }

  // Auto-ingested signature-image / non-document junk — the caba512 DOC_EXT case.
  if (fromGmail && (isImageMime || isJunkExt || isJunkName)) {
    const why = isImageMime
      ? `image attachment (${doc.mimeType}) — almost always an email-signature logo, not a document`
      : isJunkName
        ? `filename looks like an inline image / signature graphic, not a document`
        : `non-document attachment (.${doc.fileName.split(".").pop()}) auto-ingested as a file`;
    return { verdict: "LIKELY-MIS-ATTACHED", signal, reasons: [why] };
  }

  // Auto-ingested Gmail document — trust depends on HOW it matched the deal.
  if (fromGmail) {
    switch (signal) {
      case "address":
        return {
          verdict: "LIKELY-CORRECT",
          signal,
          reasons: ["auto-attached because the property address was in the email"],
        };
      case "sender_principal":
        return {
          verdict: "LIKELY-CORRECT",
          signal,
          reasons: ["auto-attached from this deal's buyer/seller (exclusive to one active deal)"],
        };
      case "sender_email":
        return namesThisDeal
          ? {
              verdict: "REVIEW",
              signal,
              reasons: [`attached by the OLD sender-only rule${softenReason}`],
            }
          : {
              verdict: "LIKELY-MIS-ATTACHED",
              signal,
              reasons: [
                "attached by the OLD sender-only rule — a shared vendor or stranger matched this deal with no address/principal check (this is the bug that dumped other deals' docs here); filename does not reference this property",
              ],
            };
      case "sender_vendor":
        return namesThisDeal
          ? {
              verdict: "REVIEW",
              signal,
              reasons: [`attached from a shared vendor on the sender alone${softenReason}`],
            }
          : {
              verdict: "LIKELY-MIS-ATTACHED",
              signal,
              reasons: ["attached from a shared vendor (title/co-agent/lender) on the sender alone — that vendor works many deals; filename does not reference this property"],
            };
      case "party_name":
        return {
          verdict: "REVIEW",
          signal,
          reasons: [
            namesThisDeal
              ? "attached on a weak party-name match, but the filename references this property — likely keep, verify"
              : "attached on a weak party-name match — verify it's actually this property",
          ],
        };
      default:
        return {
          verdict: "REVIEW",
          signal,
          reasons: [
            (signal
              ? `auto-attached via an unrecognized signal "${signal}"`
              : "auto-attached by Gmail ingest with no recorded matching signal — sender unknown") +
              (namesThisDeal ? ", but the filename references this property — likely keep, verify" : " — verify"),
          ],
        };
    }
  }

  // Unknown source — surface it rather than guess.
  return {
    verdict: "REVIEW",
    signal,
    reasons: [`unrecognized source "${doc.source}" — verify manually`],
  };
}
