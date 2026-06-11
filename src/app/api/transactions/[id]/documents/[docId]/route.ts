/**
 * Per-document actions, tenant-scoped.
 *
 *   GET    /api/transactions/:id/documents/:docId
 *            → Downloads the raw PDF/file bytes. Content-Type from
 *              Document.mimeType. Useful for the "Download" button
 *              on the document library card and for the eSign send
 *              flow (DocumensoService uploads via URL).
 *
 *   DELETE /api/transactions/:id/documents/:docId
 *            → Removes the document row (cascades any eSign requests
 *              tied to it via the schema's onDelete: Cascade FK).
 *              No undo — the library shows a confirm step before
 *              calling.
 *
 *   PATCH  /api/transactions/:id/documents/:docId
 *            { category?: string, runClassifier?: true }
 *            → Updates the document's manual category and/or fires
 *              the AI classifier to populate suggestedRezenSlot and
 *              suggestedRezenConfidence. Both can be combined in
 *              one call.
 *
 * Every handler enforces tenancy through actor.accountId — looks
 * the doc up via its parent transaction's accountId so we can never
 * leak across tenants.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const VALID_CATEGORIES = new Set([
  "contract",
  "addendum",
  "inspection",
  "appraisal",
  "title",
  "closing",
  "other",
]);

async function loadOwnedDocument(
  txnId: string,
  docId: string,
  accountId: string,
) {
  const doc = await prisma.document.findFirst({
    where: {
      id: docId,
      transactionId: txnId,
      transaction: { accountId },
    },
  });
  return doc;
}

/* ────────────────────────────────────────────────────────────── */
/*  GET — download raw bytes                                      */
/* ────────────────────────────────────────────────────────────── */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id, docId } = await ctx.params;

  const doc = await loadOwnedDocument(id, docId, actor.accountId);
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Future: when we migrate to GCS-backed storageUrl, redirect to a
  // signed URL instead of streaming bytes through Cloud Run. For now
  // rawBytes is the source of truth.
  if (!doc.rawBytes) {
    return NextResponse.json(
      { error: "file bytes not stored", hint: "document may be metadata-only" },
      { status: 410 },
    );
  }

  return new NextResponse(new Uint8Array(doc.rawBytes), {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Content-Length": String(doc.rawBytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}

/* ────────────────────────────────────────────────────────────── */
/*  DELETE — remove the document                                  */
/* ────────────────────────────────────────────────────────────── */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id, docId } = await ctx.params;

  const doc = await loadOwnedDocument(id, docId, actor.accountId);
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    await prisma.document.delete({ where: { id: docId } });
    return NextResponse.json({ ok: true, deleted: docId });
  } catch (err) {
    logError(err, { route: "documents.delete", meta: { docId } });
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  PATCH — update category + optionally re-classify              */
/* ────────────────────────────────────────────────────────────── */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id, docId } = await ctx.params;

  let body: { category?: string; runClassifier?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const doc = await loadOwnedDocument(id, docId, actor.accountId);
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};

  if (body.category !== undefined) {
    if (body.category !== null && !VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json(
        {
          error: "invalid category",
          allowed: Array.from(VALID_CATEGORIES),
        },
        { status: 400 },
      );
    }
    patch.category = body.category;
  }

  // Re-classify is best-effort: if the AI service throws, we still
  // commit any explicit category change above and surface the
  // error in the response so the UI can show a toast.
  let classifyError: string | null = null;
  if (body.runClassifier) {
    try {
      const { env } = await import("@/lib/env");
      if (!env.OPENAI_API_KEY) {
        classifyError = "OPENAI_API_KEY not configured";
      } else if (!doc.extractedText || doc.extractedText.length < 50) {
        classifyError =
          "document has no extracted text — try the contract extractor first";
      } else {
        const { classifyDocument } = await import(
          "@/services/ai/DocumentClassifierService"
        );
        const result = await classifyDocument({
          filename: doc.fileName,
          extractedText: doc.extractedText,
          openaiApiKey: env.OPENAI_API_KEY,
        });
        if (result.slotKey) {
          patch.suggestedRezenSlot = result.slotKey;
          patch.suggestedRezenConfidence = result.confidence;
          patch.classifiedAt = new Date();
        } else {
          classifyError = result.reason ?? "no slot matched";
        }
      }
    } catch (err) {
      logError(err, { route: "documents.classify", meta: { docId } });
      classifyError =
        err instanceof Error ? err.message : "classifier failed";
    }
  }

  let updated = doc;
  if (Object.keys(patch).length > 0) {
    try {
      updated = await prisma.document.update({
        where: { id: docId },
        data: patch,
      });
    } catch (err) {
      logError(err, { route: "documents.patch", meta: { docId } });
      return NextResponse.json({ error: "update failed" }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    document: {
      id: updated.id,
      category: updated.category,
      suggestedRezenSlot: updated.suggestedRezenSlot,
      suggestedRezenConfidence: updated.suggestedRezenConfidence,
      classifiedAt: updated.classifiedAt,
    },
    classifyError,
  });
}
