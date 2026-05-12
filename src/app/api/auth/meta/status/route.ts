/**
 * GET /api/auth/meta/status
 *
 * Returns the Meta connection state for the caller's account:
 *   { connected: boolean, email: string | null, pages: [...], error? }
 *
 * "connected" means we hold a stored token blob AND can decrypt it.
 * The UI uses this to render either the connected-state row (with
 * the list of Pages + IG accounts) or the "Connect Facebook" CTA.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  MetaOAuthService,
  DEFAULT_META_SCOPES,
} from "@/services/integrations/MetaOAuthService";
import { getEncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) {
    return NextResponse.json({
      connected: false,
      email: null,
      pages: [],
      error: "META_* env vars not configured",
    });
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

  const stored = await oauth.getStoredTokens(actor.accountId);
  if (!stored) {
    return NextResponse.json({ connected: false, email: null, pages: [] });
  }

  return NextResponse.json({
    connected: true,
    email: stored.userEmail,
    // Trim what we expose to the client — never leak access tokens
    // outside the server. UI only needs labels + IDs.
    pages: stored.pages.map((p) => ({
      id: p.id,
      name: p.name,
      instagram: p.instagramBusinessAccountUsername
        ? {
            id: p.instagramBusinessAccountId,
            username: p.instagramBusinessAccountUsername,
          }
        : null,
    })),
    connectedAt: stored.connectedAt,
  });
}
