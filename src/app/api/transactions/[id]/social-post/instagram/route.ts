/**
 * POST /api/transactions/:id/social-post/instagram
 *
 * STUB. Instagram Business posting requires the
 * `instagram_content_publish` scope plus a Page+IG link, currently
 * pending Meta App Review. 501 with the specific reason until
 * unlocked.
 *
 * When approved, the body becomes the standard two-step container
 * dance:
 *   1. POST /{ig-business-id}/media with image_url + caption
 *   2. POST /{ig-business-id}/media_publish with creation_id from step 1
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  return NextResponse.json(
    {
      ok: false,
      reason: "scope_not_granted",
      message:
        "Instagram posting requires instagram_content_publish (pending Meta App Review) plus an Instagram Business account linked to your Facebook Page. Stubbed until both are in place.",
    },
    { status: 501 },
  );
}
