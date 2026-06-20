/**
 * POST /api/transactions/:id/atlas — in-app Atlas chat, scoped to one deal.
 *
 * Two shapes:
 *   { message }          → ask Atlas. Read tools run; write tools come
 *                          back as proposedActions (NOT executed).
 *   { executeActions }   → run the confirmed write actions via executeTool.
 *
 * Reuses the same brain as the Telegram bot (askAtlas + executeTool), so
 * behavior + confirm-before-write are identical. The deal address is
 * prepended to the message so find_deal locks onto THIS transaction.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { askAtlas, type ProposedAction } from "@/services/ai/AtlasChatService";
import { executeTool, type AtlasActor } from "@/services/ai/AtlasTools";
import { isDealVisible } from "@/lib/deal-visibility";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: {
      id: true,
      propertyAddress: true,
      assignedUserId: true,
      restrictedToAssignee: true,
      contact: { select: { fullName: true } },
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!isDealVisible(actor, txn)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const atlasActor: AtlasActor = {
    userId: actor.userId,
    accountId: actor.accountId,
    role: actor.role,
  };
  const dealLabel = txn.propertyAddress || txn.contact?.fullName || "this deal";

  let body: { message?: string; executeActions?: ProposedAction[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    // Execute confirmed write actions.
    if (Array.isArray(body.executeActions) && body.executeActions.length > 0) {
      const results: { ok: boolean; summary: string }[] = [];
      for (const a of body.executeActions) {
        const r = await executeTool(prisma, atlasActor, a.tool, a.args);
        results.push({
          ok: r.ok,
          summary: r.ok ? r.summary : (r.error ?? "failed"),
        });
      }
      return NextResponse.json({ ok: true, results });
    }

    // Ask Atlas.
    const message = (body.message ?? "").trim();
    if (!message) return NextResponse.json({ error: "empty message" }, { status: 400 });
    const scoped = `Regarding the deal at ${dealLabel}: ${message}`;
    const reply = await askAtlas(prisma, atlasActor, scoped);
    return NextResponse.json({
      ok: true,
      text: reply.text,
      proposedActions: reply.proposedActions,
    });
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/atlas",
      transactionId: txn.id,
      accountId: actor.accountId,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Atlas error" },
      { status: 500 },
    );
  }
}
