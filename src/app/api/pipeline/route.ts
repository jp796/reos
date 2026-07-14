/**
 * GET  /api/pipeline        — merged income pipeline (auto ∪ manual) + totals
 * POST /api/pipeline        — add a manual expected-income line
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";
import { getPipeline } from "@/services/core/PipelineService";

export const runtime = "nodejs";

const create = z.object({
  business: z.string().trim().min(1).max(60).default("EPS"),
  property: z.string().trim().min(1).max(200),
  disposition: z.string().trim().min(1).max(60).default("Other"),
  expectedIncome: z.number().finite(),
  expectedDate: z.string().datetime().nullish(),
  status: z.enum(["contracted", "guess"]).default("guess"),
  note: z.string().trim().max(2000).nullish(),
  transactionId: z.string().trim().nullish(),
});

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const pipeline = await getPipeline(prisma, actor.accountId);
  return NextResponse.json({ ok: true, ...pipeline });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  let body: z.infer<typeof create>;
  try {
    body = create.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  // If a transaction is linked, it must belong to this account (tenant guard).
  if (body.transactionId) {
    const owns = await prisma.transaction.findFirst({
      where: { id: body.transactionId, accountId: actor.accountId },
      select: { id: true },
    });
    if (!owns) {
      return NextResponse.json({ error: "unknown transaction" }, { status: 400 });
    }
  }

  try {
    const item = await prisma.pipelineIncomeItem.create({
      data: {
        accountId: actor.accountId,
        business: body.business,
        property: body.property,
        disposition: body.disposition,
        expectedIncome: body.expectedIncome,
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
        status: body.status,
        note: body.note ?? null,
        transactionId: body.transactionId ?? null,
      },
    });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    logError(e, { route: "POST /api/pipeline", accountId: actor.accountId });
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
