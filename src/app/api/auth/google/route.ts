/**
 * GET /api/auth/google?accountId=<id>
 *
 * Initiates Google OAuth. Requires an existing Account row (run `pnpm db:seed`
 * to create one for local dev). Returns a 302 redirect to Google's consent
 * screen. CSRF-protected via a signed state cookie.
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { prisma } from "@/lib/db";
import { getEncryptionService } from "@/lib/encryption";
import { env } from "@/lib/env";

const STATE_COOKIE = "reos_oauth_state";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId query param is required" },
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

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Unknown accountId" }, { status: 404 });
  }

  const nonce = randomBytes(16).toString("hex");

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
  const url = oauth.generateAuthUrl(accountId, nonce);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 min
    path: "/",
  });
  return res;
}
