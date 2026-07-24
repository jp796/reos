/**
 * POST /api/transactions/:id/scan-signatures
 * Body: { docId?: string, force?: boolean }
 *
 * The "Scanned for signatures" tracker. Runs the GPT-4o vision
 * signature scan over the transaction's PDF documents and persists
 * status per doc (signed / partial / unsigned / no_signature_blocks).
 *
 *   - docId set   → scan just that document (always re-scans)
 *   - docId unset → scan every PDF with stored bytes that has no
 *                   prior result; force=true re-scans everything
 *
 * Caps at 10 docs per call to stay inside the route budget — the
 * client loops if `remaining > 0`. ~5-10s per doc.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { scanSignatures } from "@/services/ai/SignatureScanService";
import { logError } from "@/lib/log";
import { getDocumentBytes } from "@/services/storage/DocumentStorage";

export const runtime = "nodejs";
export const maxDuration = 120;

const BATCH_CAP = 10;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  let body: { docId?: string; force?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  // Tenancy: every doc lookup goes through the parent transaction.
  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!txn) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const docs = await prisma.document.findMany({
    where: {
      transactionId: id,
      mimeType: { contains: "pdf" },
      OR: [{ rawBytes: { not: null } }, { gcsPath: { not: null } }],
      ...(body.docId
        ? { id: body.docId }
        : body.force
          ? {}
          : { signatureScannedAt: null }),
    },
    select: { id: true, fileName: true, rawBytes: true, gcsPath: true },
    orderBy: { uploadedAt: "desc" },
    take: BATCH_CAP + 1, // +1 so we can report `remaining`
  });

  const batch = docs.slice(0, BATCH_CAP);
  const remaining = docs.length > BATCH_CAP ? 1 : 0; // “at least one more”

  const results: Array<{
    id: string;
    fileName: string;
    status: string | null;
    notes: string | null;
    error: string | null;
  }> = [];

  for (const d of batch) {
    try {
      const sigBytes = await getDocumentBytes(d);
      if (!sigBytes) continue;
      const r = await scanSignatures(
        sigBytes,
        env.OPENAI_API_KEY,
      );
      await prisma.document.update({
        where: { id: d.id },
        data: {
          signatureScanStatus: r.status,
          signatureScanNotes: r.notes,
          signatureScannedAt: new Date(),
        },
      });
      results.push({
        id: d.id,
        fileName: d.fileName,
        status: r.status,
        notes: r.notes,
        error: null,
      });
    } catch (err) {
      logError(err, {
        route: "scan-signatures",
        transactionId: id,
        meta: { docId: d.id },
      });
      results.push({
        id: d.id,
        fileName: d.fileName,
        status: null,
        notes: null,
        error: err instanceof Error ? err.message.slice(0, 200) : "scan failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: results.length,
    remaining,
    results,
  });
}
