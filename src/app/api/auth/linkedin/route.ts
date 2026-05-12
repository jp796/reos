/**
 * GET /api/auth/linkedin
 *
 * Starts the LinkedIn OAuth flow for the current account.
 * Mirrors /api/auth/meta. Sets a short-lived CSRF nonce cookie and
 * 302s to LinkedIn's authorization URL.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getEncryptionService } from "@/lib/encryption";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  LinkedInOAuthService,
  DEFAULT_LINKEDIN_SCOPES,
} from "@/services/integrations/LinkedInOAuthService";

export const runtime = "nodejs";

const STATE_COOKIE = "reos_linkedin_oauth_state";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

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

  const nonce = randomBytes(16).toString("hex");
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
  const url = oauth.generateAuthUrl(actor.accountId, nonce);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 30,
    path: "/",
  });
  return res;
}
