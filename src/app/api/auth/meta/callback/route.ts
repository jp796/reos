/**
 * GET /api/auth/meta/callback?code=&state=
 *
 * Handles the Meta OAuth redirect. Validates state nonce against the
 * cookie set in /api/auth/meta, exchanges the code for long-lived
 * tokens (user + page-scoped), discovers connected Pages + Instagram
 * Business accounts, and persists the encrypted bundle on the
 * Account row.
 *
 * On success → 302 to /settings/integrations?meta=connected
 * On user denial → 302 to /settings/integrations?meta=denied
 * On other failure → 302 to /settings/integrations?meta=error
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService, EncryptionService } from "@/lib/encryption";
import {
  MetaOAuthService,
  DEFAULT_META_SCOPES,
} from "@/services/integrations/MetaOAuthService";

export const runtime = "nodejs";

const STATE_COOKIE = "reos_meta_oauth_state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      new URL("/settings/integrations?meta=denied", req.url),
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
    parsedState = MetaOAuthService.parseState(state);
  } catch {
    return NextResponse.json(
      { error: "Invalid state payload" },
      { status: 400 },
    );
  }

  const cookieNonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookieNonce) {
    return NextResponse.redirect(
      new URL("/settings/integrations?meta_error=expired", req.url),
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

  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) {
    return NextResponse.json(
      { error: "META_* env vars are not configured" },
      { status: 500 },
    );
  }

  const oauth = new MetaOAuthService(
    {
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      redirectUri: env.META_REDIRECT_URI,
      scopes: DEFAULT_META_SCOPES,
    },
    prisma,
    getEncryptionService(),
  );

  try {
    const tokens = await oauth.exchangeCodeForTokens(code);
    await oauth.storeTokens(parsedState.accountId, tokens);

    const res = NextResponse.redirect(
      new URL("/settings/integrations?meta=connected", req.url),
    );
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    console.error("Meta OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/settings/integrations?meta=error", req.url),
    );
  }
}
