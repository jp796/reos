/**
 * GET  /api/private-money/partners   — the account's private-money directory
 * POST /api/private-money/partners   — add a partner
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const partner = z.object({
  name: z.string().trim().min(1).max(160),
  company: z.string().trim().max(160).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")),
  phone: z.string().trim().max(40).nullish(),
  typicalAmount: z.number().nonnegative().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const partners = await prisma.privateMoneyPartner.findMany({
    where: { accountId: actor.accountId },
    orderBy: { name: "asc" },
    include: {
      fundings: {
        include: {
          transaction: { select: { id: true, propertyAddress: true, status: true } },
        },
      },
    },
  });
  return NextResponse.json({ ok: true, partners });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  let body: z.infer<typeof partner>;
  try {
    body = partner.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }
  try {
    const item = await prisma.privateMoneyPartner.create({
      data: {
        accountId: actor.accountId,
        name: body.name,
        company: body.company || null,
        email: body.email || null,
        phone: body.phone || null,
        typicalAmount: body.typicalAmount ?? null,
        notes: body.notes || null,
      },
      select: { id: true, name: true },
    });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    logError(e, { route: "POST /api/private-money/partners", accountId: actor.accountId });
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}
