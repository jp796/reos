/**
 * POST /api/transactions/:id/generate-tasks
 * Body (optional): { contingencies?: [{name,status,description}],
 *                    financingType?: string }
 *
 * Generates an AI task list tailored to THIS deal and persists the new
 * tasks (deduped by title). Contingencies come from the body (fresh
 * extraction, e.g. the create wizard) or the deal's synthesis snapshot.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { generateDealTasks } from "@/services/core/GenerateDealTasksService";
import type { GeneratedTask } from "@/services/ai/AiTaskGenerationService";
import { logWorkflowEvent } from "@/lib/instrumentation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    contingencies?: Array<{ name: string; status?: string; description?: string }>;
    financingType?: string;
    tasks?: GeneratedTask[];
  };

  try {
    const result = await generateDealTasks(prisma, txn.accountId, id, {
      contingencies: body.contingencies,
      financingType: body.financingType,
      preGeneratedTasks: body.tasks,
    });
    if (!result) return NextResponse.json({ error: "deal not found" }, { status: 404 });
    // Funnel: the deal's task plan was activated (retail path).
    const createdCount = (result as { created?: number }).created;
    if (createdCount === undefined || createdCount > 0) {
      await logWorkflowEvent(prisma, {
        accountId: txn.accountId,
        transactionId: id,
        event: "tasks_activated",
        actorUserId: actor.userId,
        meta: createdCount === undefined ? { origin: "generate_tasks" } : { tasks: createdCount },
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "task generation failed" },
      { status: 502 },
    );
  }
}
