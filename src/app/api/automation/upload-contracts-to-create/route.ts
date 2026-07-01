/**
 * POST /api/automation/upload-contracts-to-create
 *
 * Multi-document version of upload-contract-to-create. Accepts one OR
 * MORE contract PDFs (offer + counter offer + addenda) and merges them
 * into a single extraction — newest effective date wins per field — so
 * the base offer supplies every deadline and the counter overrides only
 * the terms it changes. A counter offer read alone is mostly null by
 * design; merging is the only way to get a complete timeline.
 *
 * Flow:
 *   1. Upload N PDFs (multipart, repeated "file" fields).
 *   2. Extract each (ContractExtractionService: text + Vision fallback).
 *   3. Merge by recency → recompute relative deadlines → derive the
 *      final walkthrough as 24h before closing when not stated.
 *   4. Return the merged extraction + a per-document read log + which
 *      critical fields are still missing (never claim success blindly).
 *
 * The user reviews + edits, then POSTs to /api/automation/create-from-scan.
 */

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import {
  ContractExtractionService,
  computeRelativeDeadlines,
  mergeExtractionsByRecency,
  deriveWalkthrough,
  type ContractExtraction,
} from "@/services/ai/ContractExtractionService";

export const runtime = "nodejs";
export const maxDuration = 120;

// The fields a usable purchase-contract extraction must contain. If all
// of these are still null after the merge, surface a warning rather than
// present a blank form as success (ExtractionQuality invariant #3).
const CRITICAL: Array<keyof ContractExtraction> = [
  "closingDate",
  "inspectionDeadline",
  "inspectionObjectionDeadline",
  "financingDeadline",
  "earnestMoneyDueDate",
  "purchasePrice",
];

export async function POST(req: NextRequest) {
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

  const files = form
    .getAll("file")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "at least one file field required" },
      { status: 400 },
    );
  }
  for (const f of files) {
    if (f.type && !f.type.includes("pdf")) {
      return NextResponse.json(
        { error: `PDF required (got ${f.type || "unknown"} for ${f.name})` },
        { status: 400 },
      );
    }
    if (f.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: `${f.name} too large (max 20MB)` },
        { status: 413 },
      );
    }
  }

  const svc = new ContractExtractionService(env.OPENAI_API_KEY);

  // Extract every document (bounded concurrency to stay under the
  // function timeout while parallelizing the OpenAI round-trips).
  const perDoc: Array<{
    fileName: string;
    path: string;
    ok: boolean;
    error?: string;
    extraction?: ContractExtraction;
  }> = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const out = await Promise.all(
      batch.map(async (f) => {
        try {
          const buffer = Buffer.from(await f.arrayBuffer());
          const ex = await svc.extract(buffer);
          return {
            fileName: f.name,
            path: ex._path as string,
            ok: true,
            extraction: ex as ContractExtraction,
          };
        } catch (err) {
          return {
            fileName: f.name,
            path: "error",
            ok: false,
            error: err instanceof Error ? err.message.slice(0, 300) : String(err),
          };
        }
      }),
    );
    perDoc.push(...out);
  }

  const good = perDoc
    .filter((d) => d.ok && d.extraction)
    .map((d) => d.extraction as ContractExtraction);
  if (good.length === 0) {
    return NextResponse.json(
      {
        error: "extraction failed on all documents",
        documents: perDoc.map((d) => ({ fileName: d.fileName, error: d.error })),
      },
      { status: 502 },
    );
  }

  // Merge by recency, then recompute derived dates on the merged result
  // (a changed effective/closing date must re-derive cleanly).
  let merged = mergeExtractionsByRecency(good);
  merged = computeRelativeDeadlines(merged);
  merged = deriveWalkthrough(merged);

  const missing = CRITICAL.filter((k) => {
    const v = (merged[k] as { value?: unknown } | undefined)?.value;
    return v === null || v === undefined || v === "";
  });

  return NextResponse.json({
    ok: true,
    extraction: merged,
    documentCount: good.length,
    documents: perDoc.map((d) => ({
      fileName: d.fileName,
      path: d.path,
      ok: d.ok,
      error: d.error,
    })),
    missingCritical: missing,
  });
}
