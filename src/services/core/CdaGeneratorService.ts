/**
 * CdaGeneratorService
 *
 * Generate a Commission Disbursement Authorization PDF for a closed
 * or about-to-close transaction. Title pulls commission amounts from
 * the CDA and cuts the check; without it, title won't disburse.
 *
 * The PDF is drawn from scratch with pdf-lib — zero external template
 * files, zero fonts to manage. Output is a single-page 8.5x11 that
 * lists:
 *   - Brokerage header (name, license, address, contact) — from
 *     Account.settingsJson.broker
 *   - Transaction header (property, closing date, parties)
 *   - Commission breakdown (sale price, gross commission, referral
 *     fees, net to brokerage)
 *   - Dual-signature block (broker + title representative)
 *
 * Broker settings are read from Account.settingsJson.broker. Jp sets
 * them once via `/settings/brokerage` (built alongside this service)
 * and they auto-fill every CDA.
 *
 * Returns a Uint8Array buffer — callers wrap with NextResponse for
 * download. Never throws on optional-field absence; fields render as
 * blank lines so the TC can hand-fill if needed.
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";

export interface BrokerSettings {
  brokerageName?: string;
  brokerageAddress?: string;
  brokerageLicense?: string;
  brokeragePhone?: string;
  brokerageEmail?: string;
  /** Federal EIN — title co needs this to 1099 the brokerage. */
  brokerageEin?: string;
  designatedBrokerName?: string;
  designatedBrokerLicense?: string;
  /** Agent's name + license — if omitted, populated from session user. */
  agentName?: string;
  agentLicense?: string;
}

export interface CdaInput {
  brokerage: BrokerSettings;
  transaction: {
    propertyAddress: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    closingDate: Date | null;
    side: string | null;
    buyers: string[];
    sellers: string[];
    titleCompanyName: string | null;
  };
  financials: {
    salePrice: number | null;
    grossCommission: number | null;
    referralFeeAmount: number | null;
    brokerageSplitAmount: number | null;
    netCommission: number | null;
    commissionPercent: number | null;
  };
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "_______________";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: Date | null): string {
  if (!d) return "_______________";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function sideLabel(side: string | null): string {
  switch (side) {
    case "buy":
      return "Buyer";
    case "sell":
      return "Seller";
    case "both":
      return "Dual (Buyer + Seller)";
    default:
      return "—";
  }
}

export async function generateCda(input: CdaInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 750;
  const margin = 50;
  const width = 612 - margin * 2;

  const black = rgb(0, 0, 0);
  const muted = rgb(0.45, 0.45, 0.45);
  const rule = rgb(0.8, 0.8, 0.8);

  // --- Header band
  page.drawText("COMMISSION DISBURSEMENT AUTHORIZATION", {
    x: margin,
    y,
    size: 14,
    font: bold,
    color: black,
  });
  y -= 18;
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + width, y },
    thickness: 1,
    color: black,
  });
  y -= 25;

  const b = input.brokerage;
  // --- Brokerage block
  page.drawText(b.brokerageName ?? "Brokerage", {
    x: margin, y, size: 12, font: bold, color: black,
  });
  y -= 14;
  if (b.brokerageAddress) {
    page.drawText(b.brokerageAddress, { x: margin, y, size: 10, font: helv, color: muted });
    y -= 12;
  }
  const brokerContactLine = [
    b.brokeragePhone,
    b.brokerageEmail,
    b.brokerageLicense ? `Lic# ${b.brokerageLicense}` : null,
    b.brokerageEin ? `EIN ${b.brokerageEin}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (brokerContactLine) {
    page.drawText(brokerContactLine, { x: margin, y, size: 9, font: helv, color: muted });
    y -= 14;
  }
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.5, color: rule });
  y -= 20;

  // --- Transaction block
  drawLabelValue(page, helv, bold, margin, y, "Property", formatProperty(input.transaction));
  y -= 16;
  drawLabelValue(
    page, helv, bold, margin, y,
    "Buyer(s)",
    input.transaction.buyers.length > 0 ? input.transaction.buyers.join(", ") : "—",
  );
  y -= 16;
  drawLabelValue(
    page, helv, bold, margin, y,
    "Seller(s)",
    input.transaction.sellers.length > 0 ? input.transaction.sellers.join(", ") : "—",
  );
  y -= 16;
  drawLabelValue(page, helv, bold, margin, y, "Closing date", fmtDate(input.transaction.closingDate));
  y -= 16;
  drawLabelValue(page, helv, bold, margin, y, "Representation", sideLabel(input.transaction.side));
  y -= 16;
  drawLabelValue(
    page, helv, bold, margin, y,
    "Title / settlement co",
    input.transaction.titleCompanyName ?? "—",
  );
  y -= 16;
  if (b.agentName) {
    drawLabelValue(
      page, helv, bold, margin, y,
      "Agent",
      b.agentLicense ? `${b.agentName} (Lic# ${b.agentLicense})` : b.agentName,
    );
    y -= 16;
  }
  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.5, color: rule });
  y -= 20;

  // --- Commission breakdown
  page.drawText("COMMISSION DISBURSEMENT", { x: margin, y, size: 11, font: bold, color: black });
  y -= 18;

  const f = input.financials;
  const rows: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: "Sale price", value: fmtMoney(f.salePrice) },
    {
      label: `Gross commission${f.commissionPercent ? ` (${f.commissionPercent}%)` : ""}`,
      value: fmtMoney(f.grossCommission),
    },
    {
      label: "Less referral fee",
      value: f.referralFeeAmount ? `(${fmtMoney(f.referralFeeAmount)})` : fmtMoney(null),
    },
    {
      label: "Less brokerage split",
      value: f.brokerageSplitAmount ? `(${fmtMoney(f.brokerageSplitAmount)})` : fmtMoney(null),
    },
    {
      label: "NET DISBURSEMENT TO BROKERAGE",
      value: fmtMoney(f.netCommission),
      bold: true,
    },
  ];
  for (const r of rows) {
    const font = r.bold ? bold : helv;
    page.drawText(r.label, { x: margin, y, size: 10, font, color: black });
    // right-align the value
    const valWidth = font.widthOfTextAtSize(r.value, 10);
    page.drawText(r.value, {
      x: margin + width - valWidth,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= 16;
  }

  y -= 15;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.5, color: rule });
  y -= 25;

  // --- Authorization text
  const auth =
    "The above-named brokerage hereby authorizes and directs the settlement / title agent " +
    "to disburse the net commission amount shown above at closing by wire or check payable " +
    "to the brokerage. This authorization supersedes any prior instruction for this transaction.";
  y = drawWrapped(page, helv, auth, margin, y, width, 10, 13, black);
  y -= 20;

  // --- Signature block
  page.drawText("Broker signature:", { x: margin, y, size: 9, font: helv, color: muted });
  page.drawLine({
    start: { x: margin + 110, y: y - 2 },
    end: { x: margin + 320, y: y - 2 },
    thickness: 0.75,
    color: black,
  });
  page.drawText("Date:", { x: margin + 340, y, size: 9, font: helv, color: muted });
  page.drawLine({
    start: { x: margin + 370, y: y - 2 },
    end: { x: margin + 480, y: y - 2 },
    thickness: 0.75,
    color: black,
  });
  y -= 12;
  if (b.designatedBrokerName) {
    page.drawText(b.designatedBrokerName, { x: margin + 115, y, size: 9, font: helv, color: muted });
    y -= 12;
  }
  y -= 20;

  page.drawText("Title / settlement officer:", { x: margin, y, size: 9, font: helv, color: muted });
  page.drawLine({
    start: { x: margin + 140, y: y - 2 },
    end: { x: margin + 320, y: y - 2 },
    thickness: 0.75,
    color: black,
  });
  page.drawText("Date:", { x: margin + 340, y, size: 9, font: helv, color: muted });
  page.drawLine({
    start: { x: margin + 370, y: y - 2 },
    end: { x: margin + 480, y: y - 2 },
    thickness: 0.75,
    color: black,
  });
  y -= 30;

  page.drawText(
    `Generated by REOS · ${new Date().toLocaleString()}`,
    { x: margin, y: 40, size: 7, font: helv, color: muted },
  );

  return await doc.save();
}

function drawLabelValue(
  page: PDFPage,
  helv: import("pdf-lib").PDFFont,
  bold: import("pdf-lib").PDFFont,
  x: number,
  y: number,
  label: string,
  value: string,
) {
  page.drawText(label + ":", { x, y, size: 10, font: bold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(value, { x: x + 130, y, size: 10, font: helv, color: rgb(0, 0, 0) });
}

function drawWrapped(
  page: PDFPage,
  font: import("pdf-lib").PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  lineHeight: number,
  color: ReturnType<typeof rgb>,
): number {
  const words = text.split(/\s+/);
  let line = "";
  let yCur = y;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    const w = font.widthOfTextAtSize(test, size);
    if (w > maxWidth && line) {
      page.drawText(line, { x, y: yCur, size, font, color });
      yCur -= lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y: yCur, size, font, color });
    yCur -= lineHeight;
  }
  return yCur;
}

function formatProperty(t: CdaInput["transaction"]): string {
  const addr = t.propertyAddress ?? "—";
  const locParts = [t.city, t.state, t.zip].filter(Boolean).join(", ");
  return locParts ? `${addr}, ${locParts}` : addr;
}
