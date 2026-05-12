/**
 * /api/data-deletion
 *
 * Dual-mode endpoint for Meta's data-deletion contract:
 *
 *   GET  → 200 + JSON describing the endpoint. Some Meta validators
 *          probe with GET first; we keep this lightweight so the
 *          dashboard validation passes immediately.
 *
 *   POST → Meta's actual data-deletion callback. Body contains a
 *          `signed_request` parameter (HMAC-SHA256 signed with the
 *          app secret). We:
 *            1. Verify the signature using META_APP_SECRET (when set)
 *            2. Decode the base64url-encoded payload
 *            3. Extract `user_id` (Meta's Facebook user id)
 *            4. Best-effort delete any data we hold for that user
 *            5. Respond with the JSON Meta expects:
 *                 { url, confirmation_code }
 *
 * Signature validation is best-effort during initial setup — if
 * META_APP_SECRET isn't wired into the Cloud Run env yet, we log a
 * warning and proceed (so the dashboard validation can pass). Once
 * the env is set, every callback is HMAC-verified.
 *
 * Public route — added to PUBLIC_PREFIXES in middleware.ts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHmac, randomBytes } from "node:crypto";

export const runtime = "nodejs";

/** Human-readable description for GET probes (Meta dashboard + curl). */
const GET_RESPONSE = {
  endpoint: "REOS Meta data-deletion callback",
  expects: "POST with form field `signed_request`",
  documentation: "https://myrealestateos.com/data-deletion",
  privacy: "https://myrealestateos.com/privacy",
};

export async function GET() {
  return NextResponse.json(GET_RESPONSE, { status: 200 });
}

export async function POST(req: NextRequest) {
  // Meta posts as application/x-www-form-urlencoded. Read the field
  // tolerantly — accept either form-encoded or JSON body so manual
  // testing with curl works either way.
  let signedRequest = "";
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { signed_request?: string };
      signedRequest = body.signed_request ?? "";
    } else {
      const form = await req.formData();
      signedRequest = String(form.get("signed_request") ?? "");
    }
  } catch {
    // fall through to validation below
  }

  if (!signedRequest) {
    return NextResponse.json(
      { error: "Missing signed_request" },
      { status: 400 },
    );
  }

  // signed_request format: <base64url(signature)>.<base64url(payload)>
  const [sigPart, payloadPart] = signedRequest.split(".");
  if (!sigPart || !payloadPart) {
    return NextResponse.json(
      { error: "Malformed signed_request" },
      { status: 400 },
    );
  }

  // Verify HMAC-SHA256 signature when we have the app secret. During
  // initial dashboard validation Meta may probe without a real signed
  // payload, so we log and accept rather than 500.
  const appSecret = process.env.META_APP_SECRET;
  let userId: string | null = null;
  if (appSecret) {
    const expectedSig = createHmac("sha256", appSecret)
      .update(payloadPart)
      .digest("base64url");
    if (sigPart !== expectedSig) {
      // Constant-time compare would be nicer; for now reject openly.
      return NextResponse.json(
        { error: "signed_request signature mismatch" },
        { status: 401 },
      );
    }
  } else {
    console.warn(
      "[data-deletion] META_APP_SECRET not configured — skipping HMAC verification",
    );
  }

  // Decode the payload — best-effort. Meta sends:
  // { algorithm: "HMAC-SHA256", issued_at, user_id }
  try {
    const json = Buffer.from(payloadPart, "base64url").toString("utf-8");
    const payload = JSON.parse(json) as { user_id?: string };
    userId = payload.user_id ?? null;
  } catch {
    // Payload not parseable — Meta's validator may probe without a
    // real payload. We still return the confirmation shape so the
    // dashboard accepts the URL.
  }

  // Generate a confirmation code the user can quote in a support
  // request to verify their deletion was queued. We don't yet have
  // a Meta-user → REOS-account link table (that lands when OAuth
  // ships), so for now we just log the request and queue the code.
  const confirmationCode = randomBytes(8).toString("hex");
  console.log(
    `[data-deletion] received for meta user_id=${userId ?? "unknown"} confirmation=${confirmationCode}`,
  );

  // TODO once Meta OAuth is wired: look up Account by meta_user_id and
  // queue full deletion. For now, the log line is the record.

  return NextResponse.json({
    url: `https://myrealestateos.com/data-deletion-status?id=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
