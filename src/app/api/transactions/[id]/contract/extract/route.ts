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
 * If a prior extraction exists on the transaction, merge the new one
 * in field-by-field, keeping whichever value has higher confidence.
 * This lets the user upload a contract first, then a rider, and end
 * up with a single combined view (contract timeline + rider commission).
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
    // Non-field metadata (notes, _path) — keep latest
    if (k === "notes" || k === "_path") {
      out[k] = n ?? v;
      continue;
    }
    if (!isField(n) && isField(v)) {
      out[k] = v;
      continue;
    }
    if (isField(n) && isField(v)) {
      const nc = (n as { confidence?: number }).confidence ?? 0;
      const vc = (v as { confidence?: number }).confidence ?? 0;
      const nVal = (n as { value?: unknown }).value;
      if (nVal === null || nVal === undefined) {
        out[k] = v;
      } else if (vc > nc) {
        out[k] = v;
      }
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
