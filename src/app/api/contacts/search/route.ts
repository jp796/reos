/**
 * GET /api/contacts/search?q=<query>&limit=20
 *
 * Typeahead lookup for contact pickers. Matches fullName (case-insensitive
 * contains) and primaryEmail. Returns the top N.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10), 1),
    50,
  );

  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) return NextResponse.json({ items: [] });

  if (!q) {
    const recent = await prisma.contact.findMany({
      where: { accountId: account.id },
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
      accountId: account.id,
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
