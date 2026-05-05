/**
 * POST /api/listings/extract
 * Multipart form: { file: <listing agreement PDF> }
 *
 * Runs ListingExtractionService and returns the structured fields.
 * The new-listing form pre-fills from this response; the user
 * confirms + submits, which creates the listing through
 * /api/listings (no automatic create from extract — keeps the human
 * in the loop).
 */

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { ListingExtractionService } from "@/services/ai/ListingExtractionService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

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
    return NextResponse.json(
      { error: "file too large (max 20MB)" },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const svc = new ListingExtractionService(env.OPENAI_API_KEY);

  try {
    const extraction = await svc.extract(buffer);
    return NextResponse.json({ ok: true, extraction });
  } catch (e) {
    logError(e, {
      route: "/api/listings/extract",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    const msg = e instanceof Error ? e.message : "extract failed";
    return NextResponse.json(
      { error: `extraction failed: ${msg.slice(0, 300)}` },
      { status: 502 },
    );
  }
}
