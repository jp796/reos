/**
 * POST /api/integrations/fub/sync
 *
 * Triggers a Follow Up Boss contact sync for the owner account.
 * Query params:
 *   ?limit=N   — if set (1-1000), fetches first page of N contacts only.
 *                Omit to sync the entire FUB person catalog.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";

async function buildService() {
  if (!env.FUB_API_KEY) return null;
  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) return null;
  return {
    account,
    svc: new FollowUpBossService(
      account.id,
      {
        apiKey: env.FUB_API_KEY,
        systemKey: env.FUB_SYSTEM_KEY,
        webhookSecret: env.FUB_WEBHOOK_SECRET,
      },
      prisma,
      new AutomationAuditService(prisma),
    ),
  };
}

/**
 * GET /api/integrations/fub/sync
 * Dry-run: returns the FUB total and the local DB total without mutating.
 * Useful to size a sync before running it.
 */
export async function GET() {
  const built = await buildService();
  if (!built) {
    return NextResponse.json(
      { error: "FUB not configured or no account seeded" },
      { status: 500 },
    );
  }
  try {
    const { total, hasMore } = await built.svc.searchPeople({ limit: 1 });
    const dbTotal = await prisma.contact.count({
      where: { accountId: built.account.id },
    });
    return NextResponse.json({
      ok: true,
      fubTotal: total,
      dbTotal,
      pending: Math.max(0, total - dbTotal),
      hasMoreAfterOne: hasMore,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "dry-run failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!env.FUB_API_KEY) {
    return NextResponse.json(
      { error: "FUB_API_KEY not configured in .env" },
      { status: 500 },
    );
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw
    ? Math.min(Math.max(parseInt(limitRaw, 10) || 0, 1), 1000)
    : undefined;

  // MVP: single-account. Resolve the first (owner) account.
  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) {
    return NextResponse.json(
      { error: "No account row found — run `npm run db:seed`" },
      { status: 500 },
    );
  }

  const svc = new FollowUpBossService(
    account.id,
    {
      apiKey: env.FUB_API_KEY,
      systemKey: env.FUB_SYSTEM_KEY,
      webhookSecret: env.FUB_WEBHOOK_SECRET,
    },
    prisma,
    new AutomationAuditService(prisma),
  );

  const startedAt = Date.now();
  try {
    const result = limit
      ? await svc.syncPeopleFirstPage(limit)
      : await svc.syncAllData();

    const contactCount = await prisma.contact.count({
      where: { accountId: account.id },
    });

    return NextResponse.json({
      ok: true,
      mode: limit ? "first-page" : "full",
      limit: limit ?? null,
      durationMs: Date.now() - startedAt,
      result,
      totalContactsInDb: contactCount,
    });
  } catch (err) {
    console.error("FUB sync failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "sync failed",
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
