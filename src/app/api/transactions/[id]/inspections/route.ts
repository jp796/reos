/**
 * GET    /api/transactions/:id/inspections     — list
 * POST   /api/transactions/:id/inspections     — create
 *
 * The detail-page panel calls these. Each scheduled inspection lives
 * in the transaction_inspections table (separate from the contract
 * deadline `inspectionDate` on Transaction itself).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const create = z.object({
  label: z.string().min(1).max(120),
  kind: z
    .enum([
      "general",
      "pest",
      "radon",
      "sewer",
      "chimney",
      "pool",
      "survey",
      "other",
    ])
    .default("other"),
  scheduledAt: z.string().datetime().nullable().optional(),
  vendorNote: z.string().max(500).nullable().optional(),
  remindOnTelegram: z.boolean().optional(),
});

async function assertOwnership(transactionId: string, accountId: string) {
  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { accountId: true },
  });
  if (!txn) return "not_found";
  if (txn.accountId !== accountId) return "forbidden";
  return "ok";
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  const own = await assertOwnership(id, actor.accountId);
  if (own !== "ok") {
    return NextResponse.json(
      { error: own },
      { status: own === "not_found" ? 404 : 403 },
    );
  }
  const rows = await prisma.transactionInspection.findMany({
    where: { transactionId: id },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ ok: true, inspections: rows });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  const own = await assertOwnership(id, actor.accountId);
  if (own !== "ok") {
    return NextResponse.json(
      { error: own },
      { status: own === "not_found" ? 404 : 403 },
    );
  }

  let body: z.infer<typeof create>;
  try {
    body = create.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  try {
    const row = await prisma.transactionInspection.create({
      data: {
        transactionId: id,
        kind: body.kind,
        label: body.label,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        vendorNote: body.vendorNote ?? null,
        remindOnTelegram: body.remindOnTelegram ?? true,
      },
    });
    return NextResponse.json({ ok: true, inspection: row });
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/inspections",
      accountId: actor.accountId,
      transactionId: id,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: 500 },
    );
  }
}
