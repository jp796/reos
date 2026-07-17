/**
 * GET /api/assets/:id/project — investor PM state for the deal page's panel:
 * workflow label, whether the acquisition has closed, the active/most-recent
 * Project + its timeline tasks, and the disposition transaction (with its
 * dual-income ledger) if one exists.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import type { Strategy, TitlePath } from "@/services/core/DealClassifierService";
import { workflowLabel, hasProjectPhase } from "@/services/core/dealLabels";
import { dualIncomeForAsset } from "@/services/core/dealIncome";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const asset = await prisma.asset.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true, strategy: true, titlePath: true, representation: true },
  });
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const strategy = asset.strategy as Strategy;

  const acquisition = await prisma.transaction.findFirst({
    where: { assetId: asset.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, closingDate: true },
  });

  const project = await prisma.project.findFirst({
    where: { assetId: asset.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, type: true, status: true, projectTemplateKey: true,
      startedAt: true, targetCompletionAt: true, completedAt: true,
      dispositionTransactionId: true, fundingSourceJson: true,
      tasks: {
        orderBy: [{ isListItTask: "asc" }, { dueAt: "asc" }],
        select: {
          id: true, title: true, stageKey: true, dueAt: true, completedAt: true,
          isListItTask: true, dueDateOutOfWindow: true, priority: true,
        },
      },
      drawSchedules: {
        select: {
          id: true, totalBudget: true, retainagePercent: true, status: true,
          draws: { select: { id: true, amount: true, status: true } },
        },
      },
    },
  });

  const dispositionTransaction = project?.dispositionTransactionId
    ? await prisma.transaction.findUnique({
        where: { id: project.dispositionTransactionId },
        select: { id: true, status: true, pipelineName: true, stageName: true, dispositionIncomeJson: true },
      })
    : null;

  // Dual-income ledger (FLAG 2), computed live from the deal's flip analysis.
  const income = await dualIncomeForAsset(prisma, asset.id);

  return NextResponse.json({
    strategy,
    titlePath: asset.titlePath,
    representation: asset.representation,
    workflowLabel: workflowLabel(strategy, asset.titlePath as TitlePath | null),
    hasProjectPhase: hasProjectPhase(strategy),
    acquisitionClosed: acquisition?.status === "closed",
    project,
    dispositionTransaction,
    income,
  });
}
