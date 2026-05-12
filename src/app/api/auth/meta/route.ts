/**
 * GET /api/auth/meta
 *
 * Starts the Meta OAuth flow for the current user's account.
 * Sets a short-lived CSRF nonce cookie and 302s to Facebook's
 * dialog URL. Callback at /api/auth/meta/callback validates the
 * state, exchanges the code, and stores the resulting tokens
 * encrypted on the Account row.
 *
 * Mirrors the shape of /api/auth/google.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getEncryptionService } from "@/lib/encryption";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  MetaOAuthService,
  DEFAULT_META_SCOPES,
} from "@/services/integrations/MetaOAuthService";

export const runtime = "nodejs";

const STATE_COOKIE = "reos_meta_oauth_state";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) {
    return NextResponse.json(
      { error: "META_* env vars are not configured" },
      { status: 500 },
    );
  }

  const nonce = randomBytes(16).toString("hex");
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
  const url = oauth.generateAuthUrl(actor.accountId, nonce);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    // 30 min — same generous window the Google OAuth start uses.
    // Lets the user pop over to grant a missing permission and come
    // back without the cookie expiring.
    maxAge: 60 * 30,
    path: "/",
  });
  return res;
}
