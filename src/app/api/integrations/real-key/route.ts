/**
 * Real (ReZEN) API-key connection — financial read path.
 *
 *   GET    → { connected, agentId }
 *   POST   { apiKey } → validate via yenta /agents/me, store encrypted
 *   DELETE → disconnect
 *
 * Owner-only. The key is stored encrypted in Account.settingsJson and is
 * SEPARATE from the compliance (Bearer) token.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/require-session";
import {
  getRealAgentId,
  storeRealApiKey,
  loadRealApiKey,
  clearRealApiKey,
  RealKeyError,
} from "@/services/integrations/RealCommissionService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  const k = await loadRealApiKey(prisma, actor.accountId);
  return NextResponse.json({ ok: true, connected: !!k, agentId: k?.agentId ?? null });
}

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  let apiKey = "";
  try {
    apiKey = String(((await req.json()) as { apiKey?: string }).apiKey ?? "").trim();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!apiKey) return NextResponse.json({ error: "API key required" }, { status: 400 });
  try {
    const agentId = await getRealAgentId(apiKey);
    await storeRealApiKey(prisma, actor.accountId, apiKey, agentId);
    return NextResponse.json({ ok: true, connected: true, agentId });
  } catch (e) {
    if (e instanceof RealKeyError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    logError(e, { route: "POST /api/integrations/real-key", accountId: actor.accountId });
    return NextResponse.json({ error: "couldn't validate key" }, { status: 500 });
  }
}

export async function DELETE() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  await clearRealApiKey(prisma, actor.accountId);
  return NextResponse.json({ ok: true });
}
