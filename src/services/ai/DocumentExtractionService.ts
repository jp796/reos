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
    // Install Node-side polyfill for DOMMatrix / Path2D / ImageData
    // before pdf-parse loads. pdf-parse v2 bundles pdfjs-dist v4+
    // which references those browser-only globals during parsing —
    // certain PDFs (rotated/transformed pages, embedded images) hit
    // them and throw "DOMMatrix is not defined" otherwise.
    await import("@/lib/pdfjs-node-polyfill");
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

/** Agent/brokerage names pulled off a settlement or closing doc, used
 * to verify whether the logged-in user is actually on the deal. */
export interface AgentIdentities {
  listingAgent?: string;
  listingBroker?: string;
  sellingAgent?: string; // "selling" = buy-side in real-estate speak
  sellingBroker?: string;
  /** Raw lines that matched, for audit / debugging */
  snippets: string[];
}

export interface FinancialsExtraction {
  salePrice?: number;
  grossCommission?: number;
  commissionInferredHalf?: boolean;
  /** Stored-referral-on-the-SS signal, e.g. "less Referral $3,750" */
  referralEmbedded?: number;
  snippets: string[];
  anchors: string[];
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
   * Pull sale price + gross commission (+ optional embedded-referral
   * deduction) from a Settlement Statement buffer. Side-aware: tries the
   * side-specific commission line first, falls back to the combined
   * line halved.
   *
   * If the text layer is thin (scanned PDF / image-only), optionally
   * falls back to GPT-4o Vision for OCR-based extraction.
   */
  async extractFinancials(
    buffer: Buffer,
    side?: "buy" | "sell" | null,
    visionOpts?: { openaiApiKey?: string },
  ): Promise<FinancialsExtraction | null> {
    const text = await this.extractText(buffer);
    const textExtraction = text ? this.financialsFromText(text, side) : null;

    const thin =
      !text ||
      text.length < 200 ||
      (textExtraction &&
        !textExtraction.salePrice &&
        !textExtraction.grossCommission);

    if (thin && visionOpts?.openaiApiKey) {
      try {
        const v = await this.financialsViaVision(
          buffer,
          side,
          visionOpts.openaiApiKey,
        );
        if (v) return mergeFin(textExtraction, v);
      } catch (err) {
        console.warn(
          "SS financials vision fallback failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return textExtraction;
  }

  /**
   * GPT-4o Vision extraction for scanned SS PDFs. Renders page images
   * via pdftoppm (reused pattern from ContractExtractionService) and
   * asks the model for the same fields the regex extractor produces.
   */
  async financialsViaVision(
    buffer: Buffer,
    side: "buy" | "sell" | null | undefined,
    openaiApiKey: string,
  ): Promise<FinancialsExtraction | null> {
    const { renderPdfForVision } = await import("./PdfRender");
    const pngBuffers = await renderPdfForVision(buffer, 6);
    if (pngBuffers.length === 0) return null;

    const sys = `You are a real estate financials extractor. Given a Settlement Statement PDF (ALTA / HUD-1 / Closing Disclosure) rendered as images, return JSON with these fields:

{
  "salePrice":          number or null,
  "grossCommission":    number or null (the side-specific commission TO THE AGENT; prefer the line matching the transaction side "${side ?? "unknown"}"),
  "referralEmbedded":   number or null (any "Referral Fee" or "less Referral" deduction visible on the statement)
}

Rules:
- "side=sell" means look for the LISTING-AGENT commission line (the line going to the agent representing the seller).
- "side=buy" means look for the SELLING-AGENT / BUYER-AGENT commission line (the line going to the agent representing the buyer).
- When a broker-compensation line and a referral-fee line both appear for the same side, return the BROKER line as grossCommission and the referral amount as referralEmbedded.
- Numbers are raw (e.g. 317000 not "$317,000.00").
- Return only JSON. No prose.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 400,
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Settlement Statement rendered as ${pngBuffers.length} page image(s). Extract the financial fields.`,
              },
              ...pngBuffers.map((b) => ({
                type: "image_url" as const,
                image_url: {
                  url: `data:image/png;base64,${b.toString("base64")}`,
                  detail: "high" as const,
                },
              })),
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(
        `SS vision ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);
    return {
      snippets: ["(vision-extracted)"],
      anchors: ["vision"],
      salePrice: num(parsed.salePrice),
      grossCommission: num(parsed.grossCommission),
      referralEmbedded: num(parsed.referralEmbedded),
    };
  }

  financialsFromText(
    rawText: string,
    side?: "buy" | "sell" | null,
  ): FinancialsExtraction {
    const out: FinancialsExtraction = { snippets: [], anchors: [] };

    // Qualia/Flying S PDFs (and some First American ones) strip
    // ligatures in their text layer leaving \u0000 nulls mid-word,
    // e.g. "Lis\u0000ng" for "Listing". Strip those + control chars
    // and collapse runs of whitespace so anchor regexes match.
    // eslint-disable-next-line no-control-regex
    const text = rawText.replace(/\u0000/g, "").replace(/[\u0001-\u001F]/g, " ");

    const toNum = (s: string): number | undefined => {
      const cleaned = s.replace(/[,$\s]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : undefined;
    };

    const snippetAround = (idx: number, len: number) => {
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + len + 60);
      return text
        .slice(start, end)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);
    };

    const first = (res: RegExp[], anchorName: string): number | undefined => {
      for (const re of res) {
        const m = re.exec(text);
        if (!m) continue;
        const n = toNum(m[1]);
        if (n && n > 0) {
          out.anchors.push(anchorName);
          out.snippets.push(snippetAround(m.index, m[0].length));
          return n;
        }
      }
      return undefined;
    };

    // --- Sale price. Qualia/Flying S uses "Sale Price of Property";
    // ALTA/First American uses "Sale Price" or "Purchase Price".
    // Label may be followed by any characters before the amount.
    const SALE_PRICE_RES = [
      /Contract\s+Sales\s+Price[^$\d]{0,40}\$?([\d,]+\.\d{2})/i,
      /Sale\s+Price\s+of\s+Property[^$\d]{0,40}\$?([\d,]+\.\d{2})/i,
      /Sales?\s+Price[^$\d]{0,40}\$?([\d,]+\.\d{2})/i,
      /Purchase\s+Price[^$\d]{0,40}\$?([\d,]+\.\d{2})/i,
    ];
    const salePrice = first(SALE_PRICE_RES, "sale_price");
    if (salePrice) out.salePrice = salePrice;

    // --- Gross commission — side-specific first.
    // Labels vary: "Listing Agent Commission to Real Broker, LLC $X",
    // "Real Estate Broker Compensation to Real Broker, LLC $X", etc.
    // The pattern accepts any broker-name text between the label and
    // the dollar amount.
    const BUY_COMM_RES = [
      /Commission\s+to\s+Selling\s+Agent[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
      /Selling\s+Agent\s+Commission\s+to\s+[^\n$]{1,80}?\$?([\d,]+\.\d{2})/i,
      /Selling\s+Broker['\u2019]?s?\s+Commission[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
      /Commission\s+to\s+Buyer['\u2019]?s?\s+Agent[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
      /Buyer['\u2019]?s?\s+Agent\s+Commission[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
    ];
    // Note on Lis(ti)?ng: Qualia + some Adobe-generated PDFs strip
    // the "ti" ligature from their text layer, leaving "Listing"
    // rendered as "Lisng". We accept either form.
    const SELL_COMM_RES = [
      /Commission\s+to\s+Lis(?:ti)?ng\s+Agent[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
      /Lis(?:ti)?ng\s+Agent\s+Commission\s+to\s+[^\n$]{1,80}?\$?([\d,]+\.\d{2})/i,
      /Lis(?:ti)?ng\s+Broker['\u2019]?s?\s+Commission[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
    ];
    const COMBINED_COMM_RES = [
      /Total\s+Real\s+Estate\s+(?:Brokers?\s+)?Commission[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
      /Real\s+Estate\s+Broker\s+Compensation\s+to\s+[^\n$]{1,80}?\$?([\d,]+\.\d{2})/i,
      /Real\s+Estate\s+Commission[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
      /Broker['\u2019]?s?\s+Commission[^$\d]{0,80}\$?([\d,]+\.\d{2})/i,
    ];
    // ALTA parenthetical note style: "(Note: Commission amount $6747.50.)"
    const NOTE_COMM_RES = [
      /Commission\s+amount[:\s\.]*\$?([\d,]+\.?\d*)/i,
      /Agent\s+Commission[:\s\.]*\$?([\d,]+\.?\d*)/i,
    ];

    let gross: number | undefined;
    if (side === "buy") gross = first(BUY_COMM_RES, "commission_buy_side");
    else if (side === "sell") gross = first(SELL_COMM_RES, "commission_sell_side");
    if (!gross) {
      // Try both side-specific, prefer whichever matches
      gross =
        first(BUY_COMM_RES, "commission_buy_fallback") ??
        first(SELL_COMM_RES, "commission_sell_fallback");
    }
    if (!gross) {
      // ALTA parenthetical note — side-specific (this is the agent's commission on this SS)
      gross = first(NOTE_COMM_RES, "commission_note");
    }
    if (!gross) {
      const combined = first(COMBINED_COMM_RES, "commission_combined");
      if (combined) {
        gross = combined / 2;
        out.commissionInferredHalf = true;
      }
    }
    if (gross) out.grossCommission = gross;

    // --- Embedded referral ("Referral Fee to FastExpert, Inc. $2,377.50"
    // or "less Referral $3,750"). When present, this is the authoritative
    // referral amount — overrides any configured referral-agreement
    // percentage for this specific deal.
    const REF_EMBED_RES = [
      /less\s+Referral(?:\s+to\s+[A-Za-z0-9\s.&-]+)?[:\s\.]+\$?([\d,]+\.?\d*)/i,
      /Referral\s+Fee\s+to\s+[A-Za-z0-9\s.,&()'\-]{1,60}?\$?([\d,]+\.\d{2})/i,
      /Referral\s+(?:Fee|Paid|Out)[:\s\.]+\$?([\d,]+\.?\d*)/i,
    ];
    const embeddedRef = first(REF_EMBED_RES, "referral_embedded");
    if (embeddedRef) out.referralEmbedded = embeddedRef;

    return out;
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

  /** Parse agent + brokerage names from an SS / contract text layer.
   * Common label patterns across state forms:
   *   "Listing Agent Commission to Real Broker, LLC $5,547.50"
   *   "Selling Agent Commission to #1 Properties $7,325.00"
   *   "Real Estate Broker Compensation to Coldwell Banker ..."
   *   "Listed By: John Smith, Acme Realty"
   *   "Listing Broker: Real Broker LLC"
   */
  async extractAgentIdentities(buffer: Buffer): Promise<AgentIdentities> {
    const text = await this.extractText(buffer);
    if (!text) return { snippets: [] };
    return this.agentsFromText(text);
  }

  agentsFromText(rawText: string): AgentIdentities {
    // Strip nulls (Qualia "Lis\0ng" ligature artifact — same fix as
    // financialsFromText).
    // eslint-disable-next-line no-control-regex
    const text = rawText.replace(/\u0000/g, "").replace(/[\u0001-\u001F]/g, " ");
    const out: AgentIdentities = { snippets: [] };

    const captureUntilDollar = (pattern: RegExp): string | undefined => {
      const m = pattern.exec(text);
      if (!m) return undefined;
      const raw = m[1]?.trim();
      if (!raw) return undefined;
      const cleaned = raw
        .replace(/\s+/g, " ")
        .replace(/[.,;:]+$/, "")
        .trim();
      if (!cleaned || cleaned.length < 3 || cleaned.length > 120) return undefined;
      out.snippets.push(m[0].replace(/\s+/g, " ").trim().slice(0, 180));
      return cleaned;
    };

    // Commission-line form: "<Side> Agent Commission to <Broker> $X"
    // Captures the broker name between "to" and the dollar amount.
    out.listingBroker = captureUntilDollar(
      /Lis(?:ti)?ng\s+Agent\s+Commission\s+to\s+([^\n$]{1,80}?)\s*\$?[\d,]+\.\d{2}/i,
    );
    out.sellingBroker = captureUntilDollar(
      /Selling\s+Agent\s+Commission\s+to\s+([^\n$]{1,80}?)\s*\$?[\d,]+\.\d{2}/i,
    );
    // ALTA / First American: "Real Estate Broker Compensation to <X> $Y"
    // When this pattern appears twice, the first is listing / second is selling.
    if (!out.listingBroker) {
      out.listingBroker = captureUntilDollar(
        /Real\s+Estate\s+Broker\s+Compensation\s+to\s+([^\n$]{1,80}?)\s*\$?[\d,]+\.\d{2}/i,
      );
    }

    // Direct-label form: "Listing Agent: John Smith" or "Listed By: ..."
    const listingAgentRe = [
      /Lis(?:ti)?ng\s+Agent[:\s]+([^\n]{3,80})/i,
      /Listed\s+By[:\s]+([^\n]{3,80})/i,
    ];
    for (const re of listingAgentRe) {
      const m = re.exec(text);
      if (m) {
        const cleaned = m[1]
          ?.split(/\s{2,}/)[0]
          ?.replace(/[.,;:]+$/, "")
          ?.trim();
        if (cleaned && cleaned.length >= 3 && cleaned.length <= 80) {
          out.listingAgent = cleaned;
          out.snippets.push(m[0].replace(/\s+/g, " ").trim().slice(0, 180));
          break;
        }
      }
    }

    const sellingAgentRe = [
      /Selling\s+Agent[:\s]+([^\n]{3,80})/i,
      /Buyer['\u2019]?s?\s+Agent[:\s]+([^\n]{3,80})/i,
    ];
    for (const re of sellingAgentRe) {
      const m = re.exec(text);
      if (m) {
        const cleaned = m[1]
          ?.split(/\s{2,}/)[0]
          ?.replace(/[.,;:]+$/, "")
          ?.trim();
        if (cleaned && cleaned.length >= 3 && cleaned.length <= 80) {
          out.sellingAgent = cleaned;
          out.snippets.push(m[0].replace(/\s+/g, " ").trim().slice(0, 180));
          break;
        }
      }
    }

    return out;
  }

  /** Return true if any extracted listing/selling agent or broker text
   * matches any of the identity strings (name or brokerage). Case-
   * insensitive substring match; normalizes whitespace + punctuation. */
  static agentMatchesAny(
    identities: AgentIdentities,
    matchAgainst: string[],
  ): "match" | "no_match" | "unknown" {
    const haystack = [
      identities.listingAgent,
      identities.listingBroker,
      identities.sellingAgent,
      identities.sellingBroker,
    ]
      .filter(Boolean)
      .join(" | ")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // No agent data at all — we can't decide
    if (!haystack) return "unknown";

    for (const needle of matchAgainst) {
      const n = needle
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (n && haystack.includes(n)) return "match";
    }
    return "no_match";
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

/** Merge two FinancialsExtractions: non-null fields from the vision
 * extraction win unless the text extraction already has a number. */
function mergeFin(
  t: FinancialsExtraction | null,
  v: FinancialsExtraction,
): FinancialsExtraction {
  if (!t) return v;
  return {
    snippets: [...(t.snippets ?? []), ...(v.snippets ?? [])],
    anchors: [...(t.anchors ?? []), ...(v.anchors ?? [])],
    salePrice: t.salePrice ?? v.salePrice,
    grossCommission: t.grossCommission ?? v.grossCommission,
    commissionInferredHalf:
      t.commissionInferredHalf ?? v.commissionInferredHalf,
    referralEmbedded: t.referralEmbedded ?? v.referralEmbedded,
  };
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
