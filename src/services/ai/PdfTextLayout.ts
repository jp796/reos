/**
 * PdfTextLayout — extract a PDF's text WITH exact positions, so the
 * form-fill auto-placement can find a label (e.g. "Closing shall occur
 * on") and drop the value beside/under it. Works on flat PDFs that have
 * a real text layer (e.g. an Adobe "Print to PDF" of an XFA blank, or
 * any normal digital form). Coordinates are PDF-native (origin
 * bottom-left, points) — ready to hand to FormOverlayService.
 */

import "@/lib/pdfjs-node-polyfill";

export interface TextItem {
  page: number; // 0-indexed
  str: string;
  x: number; // left, points, PDF-native
  y: number; // baseline, points from bottom
  width: number;
  height: number;
}

export interface PageLayout {
  page: number;
  width: number;
  height: number;
}

export interface TextLayout {
  items: TextItem[];
  pages: PageLayout[];
}

async function loadPdfjs(): Promise<{ getDocument: (args: unknown) => { promise: Promise<unknown> } }> {
  try {
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
      getDocument: (args: unknown) => { promise: Promise<unknown> };
    };
  } catch {
    return (await import("pdfjs-dist")) as unknown as {
      getDocument: (args: unknown) => { promise: Promise<unknown> };
    };
  }
}

export async function extractTextLayout(pdfBytes: Uint8Array): Promise<TextLayout> {
  const pdfjs = await loadPdfjs();
  const doc = (await pdfjs.getDocument({ data: pdfBytes, isEvalSupported: false }).promise) as {
    numPages: number;
    getPage: (n: number) => Promise<unknown>;
  };

  const items: TextItem[] = [];
  const pages: PageLayout[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = (await doc.getPage(p)) as {
      getViewport: (o: { scale: number }) => { width: number; height: number };
      getTextContent: () => Promise<{ items: Array<Record<string, unknown>> }>;
    };
    const vp = page.getViewport({ scale: 1 });
    pages.push({ page: p - 1, width: vp.width, height: vp.height });
    const content = await page.getTextContent();
    for (const it of content.items) {
      const str = typeof it.str === "string" ? it.str : "";
      if (!str.trim()) continue;
      const tr = it.transform as number[] | undefined;
      if (!tr || tr.length < 6) continue;
      items.push({
        page: p - 1,
        str,
        x: tr[4],
        y: tr[5],
        width: typeof it.width === "number" ? it.width : 0,
        height: typeof it.height === "number" ? it.height : Math.abs(tr[3]) || 10,
      });
    }
  }
  return { items, pages };
}

/**
 * Place a value relative to a label that lives INSIDE a line-string.
 * Flattened forms render each line as one text item with the blanks
 * inline (e.g. "dated ___, from ___"), so we locate the line containing a
 * `find` phrase and compute the x-position by the phrase's character
 * offset within the line (proportional to the item width).
 *
 * mode "after"     → x at the END of the found phrase (the blank follows).
 * mode "lineStart" → x at the line's left edge (blank starts the line,
 *                    e.g. "$____ Dollars payable" or a seller blank line).
 *
 * `finds` are tried in order; first line-match wins. Returns null if none.
 */
export function anchorInLine(
  layout: TextLayout,
  finds: string[],
  mode: "after" | "lineStart",
  opts?: { gap?: number },
): { page: number; x: number; y: number } | null {
  const gap = opts?.gap ?? 3;
  for (const find of finds) {
    const f = find.toLowerCase();
    const hit = layout.items.find((it) => it.str.toLowerCase().includes(f));
    if (!hit) continue;
    if (mode === "lineStart") {
      return { page: hit.page, x: hit.x + gap, y: hit.y };
    }
    const idx = hit.str.toLowerCase().indexOf(f);
    const endChar = idx + find.length;
    const frac = hit.str.length > 0 ? endChar / hit.str.length : 0;
    return { page: hit.page, x: hit.x + frac * hit.width + gap, y: hit.y };
  }
  return null;
}
