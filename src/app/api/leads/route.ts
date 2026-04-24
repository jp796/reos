/**
 * GET /api/leads
 *
 * Lists LeadIntake rows for the acting user's account. Filters by
 * ?status=new|contacted|converted|dismissed — default "all".
 * Admin-facing — requires a session.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export async function GET(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const status = new URL(req.url).searchParams.get("status");

  const rows = await prisma.leadIntake.findMany({
    where: {
      accountId: actor.accountId,
      ...(status && ["new", "contacted", "converted", "dismissed"].includes(status)
        ? { status }
        : {}),
    },
    orderBy: { submittedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ items: rows });
}
