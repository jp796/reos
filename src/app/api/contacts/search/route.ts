/**
 * GET /api/contacts/search?q=<query>&limit=20
 *
 * Typeahead lookup for contact pickers. Matches fullName (case-insensitive
 * contains) and primaryEmail. Returns the top N.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // SECURITY: scope every query by the caller's account. Previously
  // this route used prisma.account.findFirst() — the "first account"
  // semantics worked in single-tenant dev but leaked every contact
  // across every tenant in production. Now: actor.accountId from
  // session, no client-supplied accountId, no fallback to findFirst.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10), 1),
    50,
  );

  if (!q) {
    const recent = await prisma.contact.findMany({
      where: { accountId: actor.accountId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        fullName: true,
        primaryEmail: true,
        sourceName: true,
      },
    });
    return NextResponse.json({ items: recent });
  }

  const items = await prisma.contact.findMany({
    where: {
      accountId: actor.accountId,
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { primaryEmail: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, fullName: true, primaryEmail: true, sourceName: true },
  });
  return NextResponse.json({ items });
}
