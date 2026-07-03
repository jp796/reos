/**
 * GET /api/forms/:id/pages
 *
 * For the field mapper: render the form's pages to images + return a
 * DRAFT auto-placement (each catalog field anchored to its label on the
 * form) merged with any saved placements. The editor shows the pages and
 * lets the user nudge each field, then saves.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { renderPdfForVision, pdfPageCount } from "@/services/ai/PdfRender";
import { pdfPageSizes } from "@/services/ai/FormOverlayService";
import { extractTextLayout, anchorInLine } from "@/services/ai/PdfTextLayout";
import { FIELD_CATALOG } from "@/services/ai/FormFieldCatalog";

export const runtime = "nodejs";
export const maxDuration = 90;

const DPI = 150;

export interface MappedField {
  field: string;
  page: number;
  xPt: number; // PDF points, origin bottom-left
  yPt: number;
  size?: number;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const form = await prisma.formTemplate.findFirst({
    where: { id, accountId: actor.accountId },
  });
  if (!form) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (form.isXfa) {
    return NextResponse.json({ error: "form is unflattened XFA" }, { status: 400 });
  }

  const buffer = Buffer.from(form.rawBytes);
  const sizes = await pdfPageSizes(new Uint8Array(buffer));
  const count = (await pdfPageCount(buffer)) ?? sizes.length;
  const pngs = await renderPdfForVision(buffer, count);
  const pages = pngs.map((png, i) => ({
    index: i,
    widthPt: sizes[i]?.width ?? 612,
    heightPt: sizes[i]?.height ?? 792,
    png: `data:image/png;base64,${png.toString("base64")}`,
  }));

  // Saved placements win; otherwise auto-place from label anchors.
  const saved = (form.placementsJson as unknown as MappedField[] | null) ?? [];
  const savedByField = new Map(saved.map((p) => [p.field, p]));

  let placements: MappedField[] = saved;
  if (saved.length === 0) {
    const layout = await extractTextLayout(new Uint8Array(buffer));
    placements = FIELD_CATALOG.map((f) => {
      const a = anchorInLine(layout, f.find, f.mode);
      return a ? { field: f.key, page: a.page, xPt: a.x, yPt: a.y } : null;
    }).filter((p): p is MappedField => p !== null);
  } else {
    // Keep saved, but add any newly-added catalog fields not yet placed.
    const layout = await extractTextLayout(new Uint8Array(buffer));
    for (const f of FIELD_CATALOG) {
      if (savedByField.has(f.key)) continue;
      const a = anchorInLine(layout, f.find, f.mode);
      if (a) placements.push({ field: f.key, page: a.page, xPt: a.x, yPt: a.y });
    }
  }

  return NextResponse.json({
    dpi: DPI,
    scale: DPI / 72,
    pages,
    placements,
    catalog: FIELD_CATALOG.map((f) => ({ key: f.key, label: f.label, kind: f.kind })),
  });
}
