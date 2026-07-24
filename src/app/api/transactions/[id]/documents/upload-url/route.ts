/**
 * POST /api/transactions/:id/documents/upload-url
 *
 * Direct-to-GCS upload, step 1 of 2. Creates the Document rows and returns a
 * short-lived signed PUT URL for each, so the browser sends bytes STRAIGHT to
 * the bucket — they never transit Cloud Run and never land in Postgres. This
 * is what makes uploads fast regardless of file size.
 *
 * Body:  { files: [{ fileName, mimeType, size }] }
 * Reply: { uploads: [{ documentId, fileName, uploadUrl, objectPath }] }
 *
 * Step 2 is POST .../documents/confirm once the PUTs succeed.
 * Falls back with 501 when GCS isn't configured — callers then use the
 * legacy multipart route.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";
import {
  gcsEnabled,
  documentObjectPath,
  createSignedUploadUrl,
} from "@/services/storage/DocumentStorage";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // direct-to-GCS lifts the old 20MB ceiling

const body = z.object({
  files: z
    .array(
      z.object({
        fileName: z.string().trim().min(1).max(240),
        mimeType: z.string().trim().max(160).optional(),
        size: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(25),
  category: z.string().trim().max(60).nullish(),
  origin: z.string().trim().max(60).nullish(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  if (!gcsEnabled()) {
    return NextResponse.json(
      { error: "direct upload unavailable", fallback: "multipart" },
      { status: 501 },
    );
  }

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }

  const tooBig = input.files.find((f) => (f.size ?? 0) > MAX_BYTES);
  if (tooBig) {
    return NextResponse.json({ error: `"${tooBig.fileName}" is over 50 MB` }, { status: 413 });
  }

  try {
    const uploads = [];
    for (const f of input.files) {
      const mimeType = f.mimeType || "application/octet-stream";
      // Create the row first so the object path can be keyed to a stable id.
      const doc = await prisma.document.create({
        data: {
          transactionId: txn.id,
          fileName: f.fileName.slice(0, 240),
          mimeType,
          category: input.category || null,
          source: "upload",
          uploadOrigin: input.origin || "manual",
          uploadedAt: new Date(),
          // rawBytes intentionally null — the bytes live in GCS.
        },
        select: { id: true, fileName: true },
      });

      const objectPath = documentObjectPath({
        accountId: actor.accountId,
        transactionId: txn.id,
        documentId: doc.id,
        fileName: f.fileName,
      });
      await prisma.document.update({ where: { id: doc.id }, data: { gcsPath: objectPath } });

      const uploadUrl = await createSignedUploadUrl({ objectPath, mimeType });
      uploads.push({ documentId: doc.id, fileName: doc.fileName, uploadUrl, objectPath });
    }
    return NextResponse.json({ ok: true, uploads });
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/documents/upload-url",
      transactionId: id,
      accountId: actor.accountId,
    });
    return NextResponse.json({ error: "could not prepare upload" }, { status: 500 });
  }
}
