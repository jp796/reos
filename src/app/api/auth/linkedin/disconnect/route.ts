/**
 * POST /api/auth/linkedin/disconnect
 *
 * Clears the LinkedIn token blob from the account. LinkedIn has no
 * public revoke endpoint, so users who want to fully revoke must
 * also remove REOS at linkedin.com/psettings/permissions.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  await prisma.account.update({
    where: { id: actor.accountId },
    data: { linkedinOauthTokensEncrypted: null },
  });
  return NextResponse.json({ ok: true });
}
