/**
 * $ Pipeline — expected-income dashboard.
 *
 * A live version of JP's "$ Pipeline" spreadsheet tab: every expected
 * income line across the business (EPS investing + RE Agent brokerage),
 * with contracted-vs-guess totals. Auto lines are derived from REOS deals
 * with commission financials; manual lines are hand-entered for off-system
 * deals, wholesale fees, flip proceeds, and projections.
 */

import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { getPipeline } from "@/services/core/PipelineService";
import { PipelineBoard } from "./PipelineBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "$ Pipeline · REOS" };

export default async function PipelinePage() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return notFound();

  const [pipeline, deals] = await Promise.all([
    getPipeline(prisma, actor.accountId),
    prisma.transaction.findMany({
      where: { accountId: actor.accountId, isDemo: false, status: { notIn: ["dead", "terminated"] } },
      select: { id: true, propertyAddress: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
  ]);

  return (
    <PipelineBoard
      initialRows={pipeline.rows}
      initialTotals={pipeline.totals}
      deals={deals.map((d) => ({ id: d.id, address: d.propertyAddress ?? "(no address)" }))}
    />
  );
}
