/**
 * GET /api/auth/google/status
 *
 * Returns the Google connection status for the caller's account:
 *   { connected: boolean, email: string | null, error?: string }
 *
 * "connected" means we hold a refreshable token AND a recent refresh
 * succeeded. A stale or revoked refresh_token returns connected:false
 * with the underlying reason so the UI can prompt a reconnect.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { getEncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { id: true, googleOauthTokensEncrypted: true },
  });
  if (!account) {
    return NextResponse.json({ connected: false, email: null });
  }
  if (!account.googleOauthTokensEncrypted) {
    return NextResponse.json({ connected: false, email: null });
  }

  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return NextResponse.json({
      connected: false,
      email: null,
      error: "GOOGLE_* env vars not configured",
    });
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

  // Try to refresh — if Google rejects, the connection is dead even
  // though we still hold an encrypted blob.
  try {
    const stored = await oauth.getStoredTokens(account.id);
    if (!stored) {
      return NextResponse.json({ connected: false, email: null });
    }
    await oauth.createAuthenticatedClient(account.id);
    return NextResponse.json({
      connected: true,
      email: stored.userEmail ?? null,
    });
  } catch (e) {
    return NextResponse.json({
      connected: false,
      email: null,
      error: e instanceof Error ? e.message : "refresh failed",
    });
  }
}
