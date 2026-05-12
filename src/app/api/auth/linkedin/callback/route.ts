/**
 * GET /api/auth/linkedin/callback?code=&state=
 *
 * LinkedIn OAuth callback handler. Validates state nonce, exchanges
 * the code for an access token, fetches the member URN via userinfo,
 * stores the encrypted blob on Account.linkedinOauthTokensEncrypted.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService, EncryptionService } from "@/lib/encryption";
import {
  LinkedInOAuthService,
  DEFAULT_LINKEDIN_SCOPES,
} from "@/services/integrations/LinkedInOAuthService";

export const runtime = "nodejs";

const STATE_COOKIE = "reos_linkedin_oauth_state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      new URL("/settings/integrations?linkedin=denied", req.url),
    );
  }
  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing code or state" },
      { status: 400 },
    );
  }

  let parsedState;
  try {
    parsedState = LinkedInOAuthService.parseState(state);
  } catch {
    return NextResponse.json(
      { error: "Invalid state payload" },
      { status: 400 },
    );
  }

  const cookieNonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookieNonce) {
    return NextResponse.redirect(
      new URL("/settings/integrations?linkedin_error=expired", req.url),
    );
  }
  if (
    !EncryptionService.constantTimeEqual(cookieNonce, parsedState.nonce)
  ) {
    return NextResponse.json(
      { error: "State nonce mismatch (CSRF guard)" },
      { status: 400 },
    );
  }

  if (
    !env.LINKEDIN_CLIENT_ID ||
    !env.LINKEDIN_CLIENT_SECRET ||
    !env.LINKEDIN_REDIRECT_URI
  ) {
    return NextResponse.json(
      { error: "LINKEDIN_* env vars are not configured" },
      { status: 500 },
    );
  }

  const oauth = new LinkedInOAuthService(
    {
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
      redirectUri: env.LINKEDIN_REDIRECT_URI,
      scopes: DEFAULT_LINKEDIN_SCOPES,
    },
    prisma,
    getEncryptionService(),
  );

  try {
    const tokens = await oauth.exchangeCodeForTokens(code);
    await oauth.storeTokens(parsedState.accountId, tokens);

    const res = NextResponse.redirect(
      new URL("/settings/integrations?linkedin=connected", req.url),
    );
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("LinkedIn OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/settings/integrations?linkedin=error", req.url),
    );
  }
}
