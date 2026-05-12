/**
 * POST /api/transactions/:id/social-post/linkedin
 *
 * Publishes a caption (+ optional photoUrl) to the caller's connected
 * LinkedIn account via the UGC Posts API.
 *
 * Body: { text: string, photoUrl?: string }
 * Returns: { ok: true, postUrl, shareUrn } on success.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { publishToLinkedIn } from "@/services/ai/LinkedInPostService";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  let body: { text?: string; photoUrl?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json(
      { error: "text is required" },
      { status: 400 },
    );
  }

  try {
    const result = await publishToLinkedIn(prisma, {
      accountId: actor.accountId,
      text,
      photoUrl: body.photoUrl ?? null,
    });

    // Audit row — entity + actor + outcome for adoption tracking.
    try {
      await prisma.automationAuditLog.create({
        data: {
          accountId: actor.accountId,
          transactionId: txn.id,
          entityType: "social_post",
          entityId: result.shareUrn,
          ruleName: "linkedin_post",
          actionType: "create",
          sourceType: "manual",
          confidenceScore: 1.0,
          decision: "applied",
          beforeJson: Prisma.JsonNull,
          afterJson: {
            platform: "linkedin",
            textLength: text.length,
            hasPhoto: !!body.photoUrl,
            postUrl: result.postUrl,
          },
          actorUserId: actor.userId,
        },
      });
    } catch {
      // audit failure must never block the post
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = /not connected/i.test(msg) ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
