/**
 * GET /api/integrations/rezen/status
 *   → { connected, email } for the Settings → Integrations card.
 *     Does not decrypt or validate the token live (no Real round
 *     trip) — just reports presence + the stored email.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { realApiTokensEncrypted: true },
  });
  if (!account?.realApiTokensEncrypted) {
    return NextResponse.json({ connected: false });
  }
  let email: string | null = null;
  let connectedAt: string | null = null;
  try {
    const blob = JSON.parse(
      getEncryptionService().decrypt(account.realApiTokensEncrypted),
    ) as { email?: string; connectedAt?: string };
    email = blob.email ?? null;
    connectedAt = blob.connectedAt ?? null;
  } catch {
    // corrupt/old envelope — treat as connected-but-unknown
  }
  return NextResponse.json({ connected: true, email, connectedAt });
}
