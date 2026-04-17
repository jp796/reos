/**
 * GET /api/auth/google/callback?code=&state=
 *
 * Handles the OAuth callback. Validates state nonce against the cookie set
 * in /api/auth/google, then exchanges the code for tokens and stores them
 * encrypted on the Account row.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { prisma } from "@/lib/db";
import { getEncryptionService, EncryptionService } from "@/lib/encryption";
import { env } from "@/lib/env";

const STATE_COOKIE = "reos_oauth_state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(new URL("/?google=denied", req.url));
  }
  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing code or state" },
      { status: 400 },
    );
  }

  let parsedState;
  try {
    parsedState = GoogleOAuthService.parseState(state);
  } catch {
    return NextResponse.json(
      { error: "Invalid state payload" },
      { status: 400 },
    );
  }

  const cookieNonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookieNonce || !EncryptionService.constantTimeEqual(cookieNonce, parsedState.nonce)) {
    return NextResponse.json(
      { error: "State nonce mismatch (CSRF guard)" },
      { status: 400 },
    );
  }

  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return NextResponse.json(
      { error: "GOOGLE_* env vars are not configured" },
      { status: 500 },
    );
  }

  const oauth = new GoogleOAuthService(
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
      scopes: DEFAULT_SCOPES,
    },
    prisma,
    getEncryptionService(),
  );

  try {
    const { tokens, userEmail } = await oauth.exchangeCodeForTokens(code);
    await oauth.storeTokens(parsedState.accountId, tokens, userEmail);

    const res = NextResponse.redirect(new URL("/?google=connected", req.url));
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?google=error", req.url));
  }
}
