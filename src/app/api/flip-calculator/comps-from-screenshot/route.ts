/**
 * POST /api/flip-calculator/comps-from-screenshot
 * Multipart form: { image: <screenshot image> }
 * JSON body: { imageBase64: string, mimeType: string }
 *
 * Runs CompsScreenshotService and returns the structured comparable
 * rows the flip calculator uses to seed comp inputs.
 */

import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { extractCompsFromImage } from "@/services/ai/CompsScreenshotService";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

interface JsonBody {
  imageBase64?: unknown;
  mimeType?: unknown;
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const rl = rateLimit(
    `comps-screenshot:${actor.accountId}:${clientIp(req)}`,
    20,
    60_000,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterS) },
      },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";

  let buffer: Buffer;
  let mimeType: string;

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "multipart required" },
        { status: 400 },
      );
    }

    const image = form.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "image field required" },
        { status: 400 },
      );
    }

    mimeType = image.type;
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: "unsupported image type" },
        { status: 400 },
      );
    }

    buffer = Buffer.from(await image.arrayBuffer());
  } else {
    let body: JsonBody;
    try {
      body = (await req.json()) as JsonBody;
    } catch {
      return NextResponse.json({ error: "json required" }, { status: 400 });
    }

    const imageBase64 =
      typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
    mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "";

    if (!imageBase64 || !mimeType) {
      return NextResponse.json(
        { error: "imageBase64 and mimeType required" },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: "unsupported image type" },
        { status: 400 },
      );
    }

    const cleanBase64 = imageBase64.replace(
      /^data:[^;]+;base64,/i,
      "",
    );

    try {
      buffer = Buffer.from(cleanBase64, "base64");
    } catch {
      return NextResponse.json(
        { error: "invalid base64 image" },
        { status: 400 },
      );
    }
  }

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "image too large (max 10MB)" },
      { status: 413 },
    );
  }

  try {
    const comps = await extractCompsFromImage(buffer, mimeType);
    return NextResponse.json({ comps });
  } catch (e) {
    logError(e, {
      route: "/api/flip-calculator/comps-from-screenshot",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    return NextResponse.json(
      {
        error: `extraction failed: ${(
          e instanceof Error ? e.message : "extract failed"
        ).slice(0, 300)}`,
      },
      { status: 502 },
    );
  }
}
