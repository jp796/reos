/**
 * POST /api/task-templates/learn
 *
 * Re-mine the account's closed deals and rewrite the learned task
 * templates (source="learned"). Owner-triggered. Idempotent.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { learnTaskTemplates } from "@/services/core/TaskTemplateLearnService";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  try {
    const result = await learnTaskTemplates(prisma, actor.accountId);
    return NextResponse.json({
      ok: true,
      ...result,
      summary:
        result.templatesWritten > 0
          ? `Learned ${result.templatesWritten} template(s) from ${result.scannedDeals} closed deal(s).`
          : `Scanned ${result.scannedDeals} closed deal(s) — not enough history yet to synthesize a template (need ≥3 similar deals with recurring tasks).`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "learn failed" },
      { status: 502 },
    );
  }
}
