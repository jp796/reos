/**
 * GET /api/scan/runs — recent ScanRun rows for polling. Limit 10.
 * Used by the Scan UI to show progress + history without redoing
 * the page-level data fetch.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const recent = await prisma.scanRun.findMany({
    where: { accountId: actor.accountId },
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  return NextResponse.json({
    runs: recent.map((r) => ({
      id: r.id,
      scanType: r.scanType,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      hitsCount: r.hitsCount,
      errorText: r.errorText,
      paramsJson: r.paramsJson,
    })),
  });
}
