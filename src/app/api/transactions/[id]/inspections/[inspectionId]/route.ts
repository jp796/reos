/**
 * PATCH  /api/transactions/:id/inspections/:inspectionId
 * DELETE /api/transactions/:id/inspections/:inspectionId
 *
 * Updates / removes a single inspection row. Auth scope: caller must
 * own the same account as the transaction.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const KINDS = [
  "whole_home",
  "partial_home",
  "plumbing",
  "heating",
  "electrical",
  "foundation",
  "sewer",
  "roof",
  "well_septic",
  "survey",
  "other",
] as const;

const patch = z.object({
  label: z.string().min(1).max(120).optional(),
  kind: z.enum(KINDS).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  vendorName: z.string().max(120).nullable().optional(),
  vendorNote: z.string().max(500).nullable().optional(),
  remindOnTelegram: z.boolean().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

async function loadOwned(
  inspectionId: string,
  transactionId: string,
  accountId: string,
) {
  const row = await prisma.transactionInspection.findUnique({
    where: { id: inspectionId },
    include: { transaction: { select: { accountId: true, id: true } } },
  });
  if (!row) return { row: null as never, status: "not_found" as const };
  if (row.transactionId !== transactionId)
    return { row: null as never, status: "mismatch" as const };
  if (row.transaction.accountId !== accountId)
    return { row: null as never, status: "forbidden" as const };
  return { row, status: "ok" as const };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; inspectionId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id, inspectionId } = await ctx.params;
  const { status } = await loadOwned(inspectionId, id, actor.accountId);
  if (status !== "ok") {
    return NextResponse.json(
      { error: status },
      { status: status === "not_found" ? 404 : 403 },
    );
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
    const updated = await prisma.transactionInspection.update({
      where: { id: inspectionId },
      data: {
        ...(body.label !== undefined && { label: body.label }),
        ...(body.kind !== undefined && { kind: body.kind }),
        ...(body.scheduledAt !== undefined && {
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        }),
        ...(body.vendorName !== undefined && { vendorName: body.vendorName }),
        ...(body.vendorNote !== undefined && { vendorNote: body.vendorNote }),
        ...(body.remindOnTelegram !== undefined && {
          remindOnTelegram: body.remindOnTelegram,
        }),
        ...(body.completedAt !== undefined && {
          completedAt: body.completedAt ? new Date(body.completedAt) : null,
        }),
      },
    });
    return NextResponse.json({ ok: true, inspection: updated });
  } catch (e) {
    logError(e, {
      route: "PATCH inspection",
      accountId: actor.accountId,
      transactionId: id,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; inspectionId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id, inspectionId } = await ctx.params;
  const { status } = await loadOwned(inspectionId, id, actor.accountId);
  if (status !== "ok") {
    return NextResponse.json(
      { error: status },
      { status: status === "not_found" ? 404 : 403 },
    );
  }

  await prisma.transactionInspection.delete({ where: { id: inspectionId } });
  return NextResponse.json({ ok: true });
}
