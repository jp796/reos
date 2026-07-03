/**
 * generateDealTasks — build an AI-tailored task list for a deal from its
 * stored terms (dates, contingencies, side, cash-vs-financed) and persist
 * the new tasks (deduped by title). Shared by the generate-tasks endpoint
 * and the Atlas `generate_tasks` tool.
 */

import type { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import {
  generateAiTasks,
  type GeneratedTask,
  type TaskGenInput,
} from "@/services/ai/AiTaskGenerationService";
import { learnedTitlesForDeal } from "./TaskTemplateLearnService";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export interface GenerateDealTasksResult {
  created: number;
  skipped: number;
  tasks: GeneratedTask[];
  summary: string;
}

export async function generateDealTasks(
  db: PrismaClient,
  accountId: string,
  transactionId: string,
  opts?: {
    contingencies?: Array<{ name: string; status?: string; description?: string }>;
    financingType?: string | null;
    /** Tasks already generated (e.g. streamed in the live view) — persist
     *  these instead of a second model call. */
    preGeneratedTasks?: GeneratedTask[];
  },
): Promise<GenerateDealTasksResult | null> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  const txn = await db.transaction.findFirst({
    where: { id: transactionId, accountId },
    include: {
      financials: { select: { salePrice: true } },
      asset: { select: { strategy: true } },
    },
  });
  if (!txn) return null;

  const snapshotConts =
    ((txn.synthesisJson as { contingencies?: unknown } | null)?.contingencies as
      | Array<{ name: string; status?: string; description?: string }>
      | undefined) ?? [];

  const financingType = opts?.financingType ?? (txn.lenderName ? "Financed" : null);
  const learnedTaskTitles = await learnedTitlesForDeal(accountId, {
    side: txn.side,
    strategy: txn.asset?.strategy ?? null,
    financingType,
  });

  const input: TaskGenInput = {
    side: (txn.side as TaskGenInput["side"]) ?? null,
    strategy: txn.asset?.strategy ?? null,
    propertyAddress: txn.propertyAddress,
    purchasePrice: txn.financials?.salePrice ?? null,
    financingType,
    titleCompany: txn.titleCompanyName,
    lender: txn.lenderName,
    dates: {
      effectiveDate: iso(txn.contractDate),
      earnestMoneyDueDate: iso(txn.earnestMoneyDueDate),
      inspectionDeadline: iso(txn.inspectionDate),
      inspectionObjectionDeadline: iso(txn.inspectionObjectionDate),
      titleCommitmentDeadline: iso(txn.titleDeadline),
      titleObjectionDeadline: iso(txn.titleObjectionDate),
      financingDeadline: iso(txn.financingDeadline),
      walkthroughDate: iso(txn.walkthroughDate),
      closingDate: iso(txn.closingDate),
      possessionDate: iso(txn.possessionDate),
    },
    contingencies: opts?.contingencies ?? snapshotConts,
    learnedTaskTitles,
  };

  // Reuse tasks already generated in the live view (token-efficient);
  // otherwise generate now.
  const tasks =
    opts?.preGeneratedTasks && opts.preGeneratedTasks.length > 0
      ? opts.preGeneratedTasks
      : await generateAiTasks(env.OPENAI_API_KEY, input);

  const existing = await db.task.findMany({
    where: { transactionId: txn.id },
    select: { title: true },
  });
  const seen = new Set(existing.map((t) => t.title.toLowerCase().trim()));
  let created = 0;
  for (const t of tasks) {
    const key = t.title.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    await db.task.create({
      data: {
        transactionId: txn.id,
        title: t.title,
        description: t.description,
        dueAt: t.dueDate ? new Date(`${t.dueDate}T12:00:00Z`) : null,
        priority: t.priority,
      },
    });
    created++;
  }

  const summary =
    created > 0
      ? `Generated ${created} tailored task${created === 1 ? "" : "s"} for ${txn.propertyAddress ?? "the deal"}${tasks.length - created > 0 ? ` (${tasks.length - created} already existed)` : ""}.`
      : `No new tasks — ${txn.propertyAddress ?? "the deal"} already has the ${tasks.length} tasks this contract calls for.`;

  return { created, skipped: tasks.length - created, tasks, summary };
}
