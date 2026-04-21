/**
 * POST /api/automation/upload-contract-to-create
 *
 * Multipart upload of a contract PDF that creates a NEW transaction
 * directly — no existing transaction required. Used when a deal
 * isn't in REOS yet (scanner missed it, or it came through a
 * channel we don't ingest).
 *
 * Flow:
 *   1. Upload PDF
 *   2. Run ContractExtractionService (text + Vision fallback)
 *   3. Return the extraction for user review (doesn't commit yet)
 *
 * The user reviews + edits on the client, then POSTs to
 * /api/automation/create-from-scan to actually persist.
 */

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";

export const runtime = "nodejs";
export const maxDuration = 90;

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

  return NextResponse.json({ ok: true, extraction });
}
