/**
 * GET /api/auth/linkedin/status
 *
 * Returns the LinkedIn connection state for the caller's account.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  LinkedInOAuthService,
  DEFAULT_LINKEDIN_SCOPES,
} from "@/services/integrations/LinkedInOAuthService";
import { getEncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (
    !env.LINKEDIN_CLIENT_ID ||
    !env.LINKEDIN_CLIENT_SECRET ||
    !env.LINKEDIN_REDIRECT_URI
  ) {
    return NextResponse.json({
      connected: false,
      email: null,
      name: null,
      error: "LINKEDIN_* env vars not configured",
    });
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

  const stored = await oauth.getStoredTokens(actor.accountId);
  if (!stored) {
    return NextResponse.json({
      connected: false,
      email: null,
      name: null,
    });
  }

  return NextResponse.json({
    connected: true,
    email: stored.email,
    name: stored.name,
    expiresAt: stored.expiresAt,
    connectedAt: stored.connectedAt,
  });
}
