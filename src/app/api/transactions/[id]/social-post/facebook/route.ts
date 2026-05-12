/**
 * POST /api/transactions/:id/social-post/facebook
 *
 * STUB. Facebook Page posting requires the `pages_manage_posts`
 * scope, currently pending Meta App Review. The endpoint exists
 * so the UI button has a real target — it returns 501 with the
 * specific reason until the scope is granted.
 *
 * When unlocked, the body becomes:
 *   1. Resolve the user's first connected Page from
 *      MetaOAuthService.getStoredTokens
 *   2. If photoUrl: POST /{page-id}/photos with { url, message,
 *      access_token: page.accessToken }
 *      Else: POST /{page-id}/feed with { message, access_token }
 *   3. Return { ok: true, postId, postUrl }
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
        "Facebook posting requires the pages_manage_posts scope, which is pending Meta App Review. Once approved, this button publishes directly to your connected Page.",
    },
    { status: 501 },
  );
}
