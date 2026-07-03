/**
 * PUT /api/forms/:id/placements
 * Body: { placements: MappedField[] }
 *
 * Save the mapper's per-field coordinate map for a flat form. Reused
 * exactly on every future fill.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

interface MappedField {
  field: string;
  page: number;
  xPt: number;
  yPt: number;
  size?: number;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const form = await prisma.formTemplate.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!form) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { placements?: unknown };
  if (!Array.isArray(body.placements)) {
    return NextResponse.json({ error: "placements array required" }, { status: 400 });
  }
  const clean: MappedField[] = body.placements
    .filter((p): p is MappedField =>
      !!p && typeof p === "object" &&
      typeof (p as MappedField).field === "string" &&
      typeof (p as MappedField).page === "number" &&
      typeof (p as MappedField).xPt === "number" &&
      typeof (p as MappedField).yPt === "number",
    )
    .map((p) => ({
      field: p.field,
      page: Math.max(0, Math.round(p.page)),
      xPt: p.xPt,
      yPt: p.yPt,
      ...(typeof p.size === "number" ? { size: p.size } : {}),
    }));

  await prisma.formTemplate.update({
    where: { id },
    data: { placementsJson: clean as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({ ok: true, saved: clean.length });
}
