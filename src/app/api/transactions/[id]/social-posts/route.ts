/**
 * POST /api/transactions/:id/social-posts
 * Body: { event: "new_listing" | "under_contract" | "sold" }
 *
 * Returns three platform-tuned captions + a hashtag set the user
 * can paste into Instagram / Facebook / LinkedIn.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import {
  generateSocialPosts,
  type SocialEvent,
} from "@/services/ai/SocialPostService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID: SocialEvent[] = ["new_listing", "under_contract", "sold"];

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true, status: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { event?: string };
  let event = body.event as SocialEvent | undefined;
  if (!event) {
    // Auto-pick from the txn status
    if (txn.status === "listing") event = "new_listing";
    else if (txn.status === "active" || txn.status === "pending")
      event = "under_contract";
    else if (txn.status === "closed") event = "sold";
    else event = "new_listing";
  }
  if (!VALID.includes(event)) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  try {
    const bundle = await generateSocialPosts(prisma, id, event);
    return NextResponse.json({ ok: true, bundle });
  } catch (e) {
    logError(e, {
      route: "/api/transactions/:id/social-posts",
      transactionId: id,
      accountId: txn.accountId,
      meta: { event },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "generate failed" },
      { status: 500 },
    );
  }
}
