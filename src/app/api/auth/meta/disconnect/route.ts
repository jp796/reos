/**
 * POST /api/auth/meta/disconnect
 *
 * Revokes Meta access for the caller's account:
 *   1. Best-effort DELETE on Meta's /me/permissions so the user's
 *      app grant is cleared on their side too.
 *   2. Clear the encrypted token blob from the Account row.
 *
 * Returns 200 even if the upstream revoke fails — the local
 * disconnect is what matters.
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

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) {
    // Even with env unconfigured, clearing the column is safe.
    await prisma.account.update({
      where: { id: actor.accountId },
      data: { metaOauthTokensEncrypted: null },
    });
    return NextResponse.json({ ok: true });
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
  await oauth.disconnect(actor.accountId);
  return NextResponse.json({ ok: true });
}
