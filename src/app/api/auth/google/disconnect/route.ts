/**
 * POST /api/auth/google/disconnect
 *
 * Revokes the stored Google tokens for the caller's account, then
 * clears the encrypted blob from the DB. After this fires, every
 * Gmail/Calendar code path returns "Google not connected" until the
 * user re-runs /api/auth/google.
 *
 * Owner-only — coordinators don't get to decouple a brokerage
 * inbox they don't own.
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
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json(
      { error: "owner only" },
      { status: 403 },
    );
  }

  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  ) {
    return NextResponse.json(
      { error: "GOOGLE_* env vars not configured" },
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
    await oauth.disconnect(actor.accountId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError(e, {
      route: "/api/auth/google/disconnect",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "disconnect failed" },
      { status: 500 },
    );
  }
}
