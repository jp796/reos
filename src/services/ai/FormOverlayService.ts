/**
 * FormOverlayService — fill a FLAT PDF (no AcroForm fields) by drawing
 * values at coordinates. This is the deterministic core: given a set of
 * placements {page, x, y, text}, it stamps them onto the PDF exactly.
 *
 * Deciding the coordinates is the hard part, handled in two layers above
 * this one:
 *  - auto-placement: find each field's label in the PDF's text layer
 *    (exact positions via pdfjs) and place the value beside/under it;
 *  - a saved per-form map: once a form's placements are confirmed, they
 *    are stored on the FormTemplate and reused for exact, repeatable
 *    fills (the DocuSign "set up once, reuse" model).
 *
 * Coordinates here are PDF-native: origin BOTTOM-left, y increases up,
 * in points. Callers converting from a top-left source (pdfjs, image
 * pixels) must flip: y_pdf = pageHeight - y_top.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface Placement {
  page: number; // 0-indexed
  x: number; // points from left
  y: number; // points from bottom (PDF-native)
  text: string;
  size?: number; // default 10
  /** checkbox mark — draws an "X" instead of text when true */
  check?: boolean;
}

export interface OverlayResult {
  bytes: Uint8Array;
  drawn: number;
  skipped: number;
  pageSizes: Array<{ width: number; height: number }>;
}

/** Stamp values onto a flat PDF at the given PDF-native coordinates. */
export async function overlayTextOnPdf(
  pdfBytes: Uint8Array,
  placements: Placement[],
): Promise<OverlayResult> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const pageSizes = pages.map((p) => ({ width: p.getWidth(), height: p.getHeight() }));

  let drawn = 0;
  let skipped = 0;
  for (const p of placements) {
    const page = pages[p.page];
    if (!page) { skipped++; continue; }
    const value = p.check ? "X" : (p.text ?? "");
    if (!value) { skipped++; continue; }
    try {
      const w = page.getWidth();
      const h = page.getHeight();
      page.drawText(value, {
        // Keep the start on-page so a rough auto-placement never renders
        // a value off the edge (the mapper nudges the exact spot).
        x: Math.min(Math.max(p.x, 2), w - 4),
        y: Math.min(Math.max(p.y, 2), h - 4),
        size: p.size ?? 10,
        font,
        color: rgb(0.06, 0.09, 0.36), // ink blue, reads as filled-in
      });
      drawn++;
    } catch {
      skipped++;
    }
  }

  const bytes = await doc.save();
  return { bytes, drawn, skipped, pageSizes };
}

/** Page dimensions (points) for a PDF — used to convert top-left source
 *  coordinates (pdfjs / image pixels) into PDF-native placements. */
export async function pdfPageSizes(
  pdfBytes: Uint8Array,
): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  return doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
}
