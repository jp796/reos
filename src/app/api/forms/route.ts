/**
 * GET  /api/forms          — list the account's blank-form library
 * POST /api/forms          — upload a blank form (multipart: file, name?, category?)
 *
 * On upload we read the PDF's AcroForm fields so the library knows how
 * many fillable fields each form has (and flags flat/non-fillable ones).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { readFormFields, detectXfa } from "@/services/ai/FormFillService";
import { extractTextLayout } from "@/services/ai/PdfTextLayout";
import { flattenXfaToPdf } from "@/services/ai/XfaFlattenService";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const forms = await prisma.formTemplate.findMany({
    where: { accountId: actor.accountId },
    select: {
      id: true, name: true, category: true, fileName: true,
      fieldCount: true, isFlat: true, isXfa: true, hasText: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ forms });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart required" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 });
  }
  if (file.type && !file.type.includes("pdf")) {
    return NextResponse.json({ error: "PDF required" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 20MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const bytes = new Uint8Array(buffer);
  let fields;
  try {
    fields = await readFormFields(bytes);
  } catch (err) {
    return NextResponse.json(
      { error: `couldn't read PDF: ${err instanceof Error ? err.message.slice(0, 120) : "error"}` },
      { status: 400 },
    );
  }

  // Classify + normalize. Fillable (AcroForm) → use as-is. Adobe-only
  // XFA → auto-flatten it here (headless Chromium + pdfjs) into a usable
  // flat PDF with a text layer. A real flat PDF → probe its text layer.
  let storeBytes: Buffer = buffer;
  let isXfa = detectXfa(bytes);
  let isFlat = fields.length === 0;
  let hasText = false;

  if (isXfa) {
    try {
      const flat = await flattenXfaToPdf(bytes);
      storeBytes = Buffer.from(flat);
      const layout = await extractTextLayout(new Uint8Array(storeBytes));
      hasText = layout.items.length >= 20;
      isXfa = false; // it's now a usable flat form
      isFlat = true;
    } catch (err) {
      console.warn("[forms] XFA flatten failed:", err instanceof Error ? err.message : err);
      // Keep the original XFA; leave it flagged for manual handling.
      isXfa = true;
    }
  } else if (isFlat) {
    try {
      const layout = await extractTextLayout(bytes);
      hasText = layout.items.length >= 20;
    } catch {
      hasText = false;
    }
  }

  const name = String(form.get("name") ?? "").trim() || file.name.replace(/\.pdf$/i, "");
  const category = String(form.get("category") ?? "").trim() || null;

  const created = await prisma.formTemplate.create({
    data: {
      accountId: actor.accountId,
      name,
      category,
      fileName: file.name,
      rawBytes: storeBytes,
      fieldsJson: fields as unknown as Prisma.InputJsonValue,
      fieldCount: fields.length,
      isFlat,
      isXfa,
      hasText,
    },
    select: {
      id: true, name: true, category: true, fieldCount: true,
      isFlat: true, isXfa: true, hasText: true,
    },
  });

  return NextResponse.json({ ok: true, form: created });
}
