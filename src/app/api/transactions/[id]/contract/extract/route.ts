/**
 * POST /api/transactions/:id/contract/extract
 *
 * Multipart/form-data upload of a contract (or compensation rider) PDF.
 * Runs ContractExtractionService, stashes the result on the transaction
 * as `pendingContractJson` for the user to review + apply/discard.
 *
 * Returns the extraction JSON (for immediate display).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { Prisma } from "@prisma/client";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

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
  const svc = new ContractExtractionService(env.OPENAI_API_KEY);

  let extraction;
  try {
    extraction = await svc.extract(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `extraction failed: ${msg.slice(0, 300)}` },
      { status: 502 },
    );
  }

  // Persist the uploaded PDF as a Document so future rescans can
  // re-extract it without re-uploading. Done BEFORE the transaction
  // update so a persist failure doesn't silently drop the PDF.
  try {
    await prisma.document.create({
      data: {
        transactionId: txn.id,
        category: "contract",
        fileName: file.name || "contract.pdf",
        mimeType: file.type || "application/pdf",
        rawBytes: buffer,
        source: "upload",
        uploadOrigin: "contract_upload_panel",
        uploadedAt: new Date(),
        sourceDate: new Date(),
      },
    });
  } catch (err) {
    console.warn(
      "[contract/extract] saving Document row failed (non-blocking):",
      err instanceof Error ? err.message : err,
    );
  }

  // Snapshot the PRIOR extraction (if any) before we merge the new
  // one over it. This is what powers the diff viewer — "what changed
  // between the original contract and the addendum?"
  if (txn.pendingContractJson) {
    try {
      await prisma.contractExtractionVersion.create({
        data: {
          transactionId: txn.id,
          extractionJson: txn.pendingContractJson as Prisma.InputJsonValue,
          source: "upload",
          filename: file.name || "contract.pdf",
          sourceDate: txn.contractExtractedAt ?? new Date(),
        },
      });
    } catch (err) {
      console.warn(
        "[contract/extract] snapshot prior version failed (non-blocking):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // If this upload is a compensation rider AND a prior contract extraction
  // already exists on the txn, merge the two so the user sees unified data.
  const existing = (txn.pendingContractJson ?? null) as Prisma.JsonValue | null;
  const merged = mergePending(existing, extraction as unknown as Record<string, unknown>);

  await prisma.transaction.update({
    where: { id: txn.id },
    data: {
      pendingContractJson: merged as Prisma.InputJsonValue,
      contractExtractedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, extraction: merged });
}

/**
 * Merge a new extraction onto a prior one.
 *
 * Policy: **newest wins**. When the same field exists in both, the
 * value from the new extraction ALWAYS overrides — because the user
 * just uploaded the newer PDF, so its dates/amounts are authoritative
 * (addendums, re-signed contracts, amendments, rider updates all flow
 * this way). We only FALL BACK to the prior value when the new
 * extraction didn't capture the field at all (value: null / missing).
 *
 * This is a deliberate reversal of the old "higher confidence wins"
 * policy — confidence was being used as a proxy for "better", but
 * an older high-confidence date that was since amended would incorrectly
 * stay pinned.
 */
function mergePending(
  prior: Prisma.JsonValue | null,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!prior || typeof prior !== "object" || Array.isArray(prior)) return next;
  const p = prior as Record<string, unknown>;
  const out: Record<string, unknown> = { ...next };
  for (const [k, v] of Object.entries(p)) {
    const n = (next as Record<string, unknown>)[k];
    // Non-field metadata (notes, _path, _rescan) — keep newest if set
    if (k === "notes" || k === "_path" || k === "_rescan") {
      out[k] = n ?? v;
      continue;
    }
    // Field fell off in the new extraction entirely → keep prior
    if (!isField(n) && isField(v)) {
      out[k] = v;
      continue;
    }
    // Both sides are fields. New wins IF it has a non-null value.
    // Only fall back to prior when new is explicitly null.
    if (isField(n) && isField(v)) {
      const nVal = (n as { value?: unknown }).value;
      if (nVal === null || nVal === undefined) {
        out[k] = v;
      }
      // else: new already in `out` via {...next} spread — newest wins
    }
  }
  return out;
}

function isField(x: unknown): boolean {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    "value" in (x as object) &&
    "confidence" in (x as object)
  );
}
