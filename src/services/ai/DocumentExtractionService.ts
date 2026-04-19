/**
 * DocumentExtractionService
 *
 * Phase 4 foundation — pulls structured fields out of PDF documents.
 * First use case: detect the actual closing date from a Final Settlement
 * Statement / Closing Disclosure / ALTA / HUD-1.
 *
 * Strategy:
 *   1. Extract raw text with pdf-parse
 *   2. Pattern-match date fields near labelled anchors
 *        ("Closing Date", "Settlement Date", "Disbursement Date",
 *         "Date of Settlement")
 *   3. Return the highest-confidence date + a snippet for audit
 *
 * AI fallback (OpenAI) is left as a TODO — the regex pass already covers
 * the common Settlement Statement templates from fste.com / firstam.com.
 */

// pdf-parse v2 exports a PDFParse class (no callable default), unlike
// v1 which was `pdfParse(buffer) -> {text}`. Lazy-load + adapt to keep
// the callsite shape stable.
interface PDFParseV2Instance {
  getText(): Promise<{ text: string }>;
  destroy(): void;
}
interface PDFParseV2Ctor {
  new (opts: { data: Buffer }): PDFParseV2Instance;
}
let _PDFParse: PDFParseV2Ctor | null = null;

async function pdfParse(buf: Buffer): Promise<{ text: string }> {
  if (!_PDFParse) {
    const mod = (await import("pdf-parse")) as unknown as {
      PDFParse?: PDFParseV2Ctor;
      default?: PDFParseV2Ctor | ((b: Buffer) => Promise<{ text: string }>);
    };
    if (mod.PDFParse) {
      _PDFParse = mod.PDFParse;
    } else if (mod.default && typeof mod.default === "function") {
      // Fallback for v1-style callable (not current, but defensive)
      const legacy = mod.default as (b: Buffer) => Promise<{ text: string }>;
      return legacy(buf);
    } else {
      throw new Error("pdf-parse: no PDFParse export and no callable default");
    }
  }
  const inst = new _PDFParse({ data: buf });
  try {
    const { text } = await inst.getText();
    return { text };
  } finally {
    inst.destroy();
  }
}

export interface SettlementParties {
  buyers: string[];
  sellers: string[];
  propertyAddress?: string;
  fileNumber?: string;
}

export interface ClosingDateExtraction {
  date: Date;
  /** 0–1 confidence */
  confidence: number;
  /** Which anchor fired (e.g. "Disbursement Date") */
  anchor: string;
  /** Source snippet around the date (for audit evidence) */
  snippet: string;
  /** Document-type guess */
  documentType:
    | "settlement_statement"
    | "closing_disclosure"
    | "alta"
    | "hud_1"
    | "unknown";
}

// Anchors we search for, roughly ordered by how authoritative they are
// for "the actual close date".
const DATE_ANCHORS: Array<{ anchor: string; weight: number }> = [
  { anchor: "Disbursement Date", weight: 1.0 }, // HUD-1 / ALTA
  { anchor: "Date of Settlement", weight: 1.0 },
  { anchor: "Settlement Date", weight: 0.95 },
  { anchor: "Closing Date", weight: 0.9 },
  { anchor: "Date of Closing", weight: 0.9 },
];

const DOC_TYPE_HINTS: Array<{
  pattern: RegExp;
  type: ClosingDateExtraction["documentType"];
}> = [
  { pattern: /closing\s+disclosure/i, type: "closing_disclosure" },
  { pattern: /ALTA\s+settlement/i, type: "alta" },
  { pattern: /HUD[-\s]?1/i, type: "hud_1" },
  { pattern: /settlement\s+statement/i, type: "settlement_statement" },
];

// Matches common US date formats:
//   "11/23/2025"   "11-23-2025"   "November 23, 2025"   "Nov 23, 2025"
//   "2025-11-23"   "23 November 2025"
const DATE_RE = new RegExp(
  [
    String.raw`(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})`,
    String.raw`((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})`,
    String.raw`(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})`,
    String.raw`(\d{4}-\d{2}-\d{2})`,
  ].join("|"),
  "i",
);

export class DocumentExtractionService {
  async extractText(buffer: Buffer): Promise<string> {
    const res = await pdfParse(buffer);
    return res.text ?? "";
  }

  /**
   * Given a Settlement Statement / Closing Disclosure buffer, return the
   * closing-equivalent date if we can find one. null if nothing usable.
   */
  async extractClosingDate(
    buffer: Buffer,
  ): Promise<ClosingDateExtraction | null> {
    const text = await this.extractText(buffer);
    if (!text) return null;

    const documentType = this.classifyDocumentType(text);

    let best: ClosingDateExtraction | null = null;

    for (const { anchor, weight } of DATE_ANCHORS) {
      const found = this.findDateNearAnchor(text, anchor);
      if (!found) continue;

      const confidence = weight * (documentType === "unknown" ? 0.8 : 1.0);
      if (!best || confidence > best.confidence) {
        best = {
          date: found.date,
          confidence,
          anchor,
          snippet: found.snippet,
          documentType,
        };
      }
    }

    return best;
  }

  private classifyDocumentType(
    text: string,
  ): ClosingDateExtraction["documentType"] {
    for (const { pattern, type } of DOC_TYPE_HINTS) {
      if (pattern.test(text)) return type;
    }
    return "unknown";
  }

  private findDateNearAnchor(
    text: string,
    anchor: string,
  ): { date: Date; snippet: string } | null {
    const idx = text.toLowerCase().indexOf(anchor.toLowerCase());
    if (idx < 0) return null;

    // Look in a window after the anchor (skip ":" and whitespace), then
    // a backup window before it (some templates place the label to the
    // right of the value).
    const windowAfter = text.slice(idx, idx + 240);
    const windowBefore = text.slice(Math.max(0, idx - 120), idx + anchor.length);

    const match = DATE_RE.exec(windowAfter) ?? DATE_RE.exec(windowBefore);
    if (!match) return null;

    const raw = match.find((g, i) => i > 0 && g);
    if (!raw) return null;
    const parsed = this.parseDate(raw);
    if (!parsed) return null;

    const windowStart = Math.max(0, idx - 40);
    const snippet = text
      .slice(windowStart, idx + anchor.length + 80)
      .replace(/\s+/g, " ")
      .trim();
    return { date: parsed, snippet };
  }

  /**
   * Pull buyers, sellers, property, and file number from Settlement
   * Statement text. Regex-only — covers the ALTA / HUD-1 / CD templates
   * from firstam + fste. OpenAI fallback is a TODO.
   */
  async extractParties(buffer: Buffer): Promise<SettlementParties | null> {
    const text = await this.extractText(buffer);
    if (!text) return null;
    return this.partiesFromText(text);
  }

  partiesFromText(text: string): SettlementParties {
    const out: SettlementParties = { buyers: [], sellers: [] };
    const windowAfter = (label: RegExp, chars = 200) => {
      const m = label.exec(text);
      if (!m) return null;
      return text.slice(m.index + m[0].length, m.index + m[0].length + chars);
    };

    const NAME_STOP =
      /\n|(?=\s{2,})|(?=Address|Property|File|Loan|Borrower|Buyer|Seller|Date|Amount|Settlement)/i;

    const cleanName = (s: string | undefined): string | null => {
      if (!s) return null;
      const cleaned = s
        .split(NAME_STOP)[0]
        .replace(/[:;]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
      return isLikelyPersonOrEntityName(cleaned) ? cleaned : null;
    };

    // Buyers: "Borrower(s)" (HUD-1, CD) or "Buyer(s)"
    const buyerWindow =
      windowAfter(/\bBorrower(?:\(s\))?[:\s]+/i) ??
      windowAfter(/\bBuyer(?:\(s\))?[:\s]+/i);
    const buyer = cleanName(buyerWindow ?? undefined);
    if (buyer) out.buyers.push(buyer);

    // Sellers — try several label phrasings
    const sellerWindow =
      windowAfter(/\bSeller(?:\(s\))?[:\s]+/i) ??
      windowAfter(/\bGrantor(?:\(s\))?[:\s]+/i);
    const seller = cleanName(sellerWindow ?? undefined);
    if (seller) out.sellers.push(seller);

    // Property address
    const propRe =
      /(?:Property|Subject\s+Property|Property\s+Address)[:\s]+(\d+\s+[^\n]{3,120})/i;
    const pm = propRe.exec(text);
    if (pm) out.propertyAddress = pm[1].split(NAME_STOP)[0].trim();

    // File / order number
    const fileRe =
      /\b(?:File(?:\s*Number|\s*#|\s*No\.?)?|Order\s*(?:Number|#|No\.?))[:\s-]\s*([A-Z0-9-]+)/i;
    const fm = fileRe.exec(text);
    if (fm) out.fileNumber = fm[1].replace(/-+$/, "").trim();

    return out;
  }

  private parseDate(s: string): Date | null {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t);

    // Handle "11-23-2025" which Date.parse interprets as ISO and breaks.
    const mdY = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (mdY) {
      const month = parseInt(mdY[1], 10) - 1;
      const day = parseInt(mdY[2], 10);
      let year = parseInt(mdY[3], 10);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      const d = new Date(year, month, day);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  }
}

// ==================================================
// NAME VALIDATION
// Settlement Statement templates include boilerplate that our regex
// sometimes slurps into the buyer/seller slot. Filter the obvious
// garbage so it doesn't pollute matching.
// ==================================================

const BAD_NAME_PATTERNS: readonly RegExp[] = [
  /^adopted/i, // ALTA "Adopted 05-01-2015" boilerplate
  /^copyright/i,
  /^american\s+land\s+title/i,
  /^all\s+rights\s+reserved/i,
  /^page\s+\d+/i,
  /^n\/a$/i,
  /^none$/i,
  /^see\s+attached/i,
  /^various$/i,
  /^buyer[s]?$/i,
  /^seller[s]?$/i,
];

function isLikelyPersonOrEntityName(s: string): boolean {
  if (!s) return false;
  const t = s.trim();
  if (t.length < 3 || t.length > 200) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  for (const pat of BAD_NAME_PATTERNS) if (pat.test(t)) return false;
  // Reject if the whole thing looks like a date
  if (/^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$/.test(t)) return false;
  return true;
}

/** Strip null bytes + other characters Postgres rejects in TEXT/JSONB. */
export function safeForDb(s: string | null | undefined): string | null {
  if (!s) return null;
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
