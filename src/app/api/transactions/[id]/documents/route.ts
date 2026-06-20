/**
 * POST /api/transactions/:id/documents
 *
 * Upload one or more files into THIS transaction's document library.
 * Each file is stored as a Document (rawBytes) scoped to the txn, so it
 * shows in the Files tab, feeds the compliance audit, and becomes
 * selectable in the E-sign panel's PDF picker.
 *
 * Body: multipart/form-data with one or more `file` fields. Optional
 * `category` and `origin` form fields tag the upload (e.g. origin
 * "wizard" when the intake wizard bulk-attaches the non-contract docs).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per file

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  // Tenancy: the transaction must belong to the acting account.
  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form" }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files" }, { status: 400 });
  }
  const category = (form.get("category") as string | null)?.trim() || null;
  const origin = (form.get("origin") as string | null)?.trim() || "manual";

  const created: { id: string; fileName: string }[] = [];
  try {
    for (const f of files) {
      if (f.size === 0) continue;
      if (f.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `"${f.name}" is over 20 MB` },
          { status: 413 },
        );
      }
      const bytes = Buffer.from(await f.arrayBuffer());
      const doc = await prisma.document.create({
        data: {
          transactionId: txn.id,
          fileName: f.name.slice(0, 240),
          mimeType: f.type || "application/octet-stream",
          rawBytes: bytes,
          category,
          source: "upload",
          uploadOrigin: origin,
          uploadedAt: new Date(),
        },
        select: { id: true, fileName: true },
      });
      created.push(doc);
    }
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/documents",
      transactionId: txn.id,
      accountId: actor.accountId,
    });
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created, count: created.length });
}
