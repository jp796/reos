/**
 * GET  /api/flip-analysis           — saved analyses (optionally ?transactionId=)
 * POST /api/flip-analysis           — save a Flip Calculator run (inputs JSON)
 *
 * Only the input set is stored; outputs are always recomputed by FlipCalcModel
 * so a re-opened analysis can never show stale numbers.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const save = z.object({
  label: z.string().trim().min(1).max(200),
  inputs: z.record(z.string(), z.unknown()),
  transactionId: z.string().trim().nullish(),
});

export async function GET(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const txnId = req.nextUrl.searchParams.get("transactionId");
  const rows = await prisma.flipAnalysis.findMany({
    where: { accountId: actor.accountId, ...(txnId ? { transactionId: txnId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, label: true, transactionId: true, inputsJson: true, updatedAt: true },
  });
  return NextResponse.json({ ok: true, analyses: rows });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  let body: z.infer<typeof save>;
  try {
    body = save.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }

  if (body.transactionId) {
    const owns = await prisma.transaction.findFirst({
      where: { id: body.transactionId, accountId: actor.accountId },
      select: { id: true },
    });
    if (!owns) return NextResponse.json({ error: "unknown transaction" }, { status: 400 });
  }

  try {
    const item = await prisma.flipAnalysis.create({
      data: {
        accountId: actor.accountId,
        transactionId: body.transactionId ?? null,
        label: body.label,
        inputsJson: body.inputs as object,
        createdByUserId: actor.userId,
      },
      select: { id: true, label: true, transactionId: true },
    });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    logError(e, { route: "POST /api/flip-analysis", accountId: actor.accountId });
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}
