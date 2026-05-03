/**
 * POST /api/onboarding/parse-checklist
 * Body (multipart):
 *   files: File[]   — 1-8 screenshot images (PNG / JPG)
 *   kind?: string   — "transaction" | "listing" — overrides Vision's guess
 *
 * Vision parses the screenshots, returns a structured slot list.
 * Caller then reviews + saves via POST /api/onboarding/save-checklist.
 */

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { parseChecklistScreenshots } from "@/services/ai/ChecklistVisionService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  let images: string[];
  try {
    const form = await req.formData();
    const files = form.getAll("files") as File[];
    if (files.length === 0) {
      return NextResponse.json(
        { error: "at least one file required" },
        { status: 400 },
      );
    }
    if (files.length > 8) {
      return NextResponse.json({ error: "max 8 files" }, { status: 400 });
    }
    images = await Promise.all(
      files.map(async (f) => {
        const buf = Buffer.from(await f.arrayBuffer());
        if (buf.length > 8 * 1024 * 1024) {
          throw new Error(`${f.name} > 8MB`);
        }
        const mime = f.type || "image/png";
        return `data:${mime};base64,${buf.toString("base64")}`;
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "form parse failed" },
      { status: 400 },
    );
  }

  try {
    const result = await parseChecklistScreenshots(images, env.OPENAI_API_KEY);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    logError(e, {
      route: "/api/onboarding/parse-checklist",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "vision parse failed" },
      { status: 500 },
    );
  }
}
