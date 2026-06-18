/**
 * POST /api/atlas/execute — run a single Atlas tool. This is the one
 * server-side execution point for agent actions; the chat / Telegram
 * layers call it AFTER the user confirms a write. Every action is
 * authenticated, tenancy + per-deal-visibility enforced inside the tool,
 * and audited.
 *
 * Body: { tool: string, args: object }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { executeTool, type AtlasActor } from "@/services/ai/AtlasTools";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as
    | { tool?: unknown; args?: unknown }
    | null;
  if (typeof body?.tool !== "string") {
    return NextResponse.json(
      { ok: false, error: "Body must be { tool: string, args: object }." },
      { status: 400 },
    );
  }

  const agentActor: AtlasActor = {
    userId: actor.userId,
    accountId: actor.accountId,
    role: actor.role,
  };

  const result = await executeTool(prisma, agentActor, body.tool, body.args ?? {});
  // Tool-level failures (not-found / ambiguous / invalid / forbidden) are
  // returned as 200 with ok:false so the chat can surface them as a
  // conversational reply, not an HTTP error.
  return NextResponse.json(result);
}
