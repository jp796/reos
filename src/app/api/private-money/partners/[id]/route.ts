/**
 * PATCH  /api/private-money/partners/[id]  — edit a partner
 * DELETE /api/private-money/partners/[id]  — remove a partner (and its fundings)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const patch = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  company: z.string().trim().max(160).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")),
  phone: z.string().trim().max(40).nullish(),
  typicalAmount: z.number().nonnegative().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

async function owns(accountId: string, id: string): Promise<boolean> {
  const p = await prisma.privateMoneyPartner.findFirst({ where: { id, accountId }, select: { id: true } });
  return !!p;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  if (!(await owns(actor.accountId, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: z.infer<typeof patch>;
  try {
    body = patch.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }
  try {
    await prisma.privateMoneyPartner.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.company !== undefined ? { company: body.company || null } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.typicalAmount !== undefined ? { typicalAmount: body.typicalAmount ?? null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError(e, { route: "PATCH /api/private-money/partners/[id]", accountId: actor.accountId });
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  if (!(await owns(actor.accountId, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    await prisma.privateMoneyPartner.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError(e, { route: "DELETE /api/private-money/partners/[id]", accountId: actor.accountId });
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
