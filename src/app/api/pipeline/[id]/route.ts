/**
 * PATCH  /api/pipeline/:id  — edit a manual expected-income line
 * DELETE /api/pipeline/:id  — remove a manual line
 *
 * Only manual rows are editable; auto lines (id "auto:<txnId>") are derived
 * live from deal financials and have no row to mutate.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const patch = z.object({
  business: z.string().trim().min(1).max(60).optional(),
  property: z.string().trim().min(1).max(200).optional(),
  disposition: z.string().trim().min(1).max(60).optional(),
  expectedIncome: z.number().finite().optional(),
  expectedDate: z.string().datetime().nullish(),
  status: z.enum(["contracted", "guess"]).optional(),
  note: z.string().trim().max(2000).nullish(),
});

async function owned(id: string, accountId: string) {
  return prisma.pipelineIncomeItem.findFirst({
    where: { id, accountId },
    select: { id: true },
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  if (!(await owned(id, actor.accountId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: z.infer<typeof patch>;
  try {
    body = patch.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  try {
    const item = await prisma.pipelineIncomeItem.update({
      where: { id },
      data: {
        ...(body.business !== undefined && { business: body.business }),
        ...(body.property !== undefined && { property: body.property }),
        ...(body.disposition !== undefined && { disposition: body.disposition }),
        ...(body.expectedIncome !== undefined && { expectedIncome: body.expectedIncome }),
        ...(body.expectedDate !== undefined && {
          expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
        }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.note !== undefined && { note: body.note ?? null }),
      },
    });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    logError(e, { route: "PATCH /api/pipeline/[id]", accountId: actor.accountId });
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  if (!(await owned(id, actor.accountId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    await prisma.pipelineIncomeItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError(e, { route: "DELETE /api/pipeline/[id]", accountId: actor.accountId });
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
