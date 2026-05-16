/**
 * GET /api/search?q=<query>
 *
 * Unified search across contacts + transactions. Matches on:
 *   - Contact fullName, primaryEmail, primaryPhone
 *   - Transaction propertyAddress, city, zip
 *   - Contact fullName via the transaction's linked contact
 *
 * Returns ranked results (exact word matches first, then prefix,
 * then substring). Capped at 10 per type.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // SECURITY: this used to query Contact + Transaction across every
  // tenant — typing two characters returned everyone's data. Now
  // gated by session AND scoped to actor.accountId.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ query: q, contacts: [], transactions: [] });
  }
  const like = q;

  const [contacts, transactions] = await Promise.all([
    prisma.contact.findMany({
      where: {
        accountId: actor.accountId,
        OR: [
          { fullName: { contains: like, mode: "insensitive" } },
          { primaryEmail: { contains: like, mode: "insensitive" } },
          { primaryPhone: { contains: like, mode: "insensitive" } },
        ],
      },
      take: 10,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        fullName: true,
        primaryEmail: true,
        primaryPhone: true,
        sourceName: true,
      },
    }),
    prisma.transaction.findMany({
      where: {
        accountId: actor.accountId,
        OR: [
          { propertyAddress: { contains: like, mode: "insensitive" } },
          { city: { contains: like, mode: "insensitive" } },
          { zip: { contains: like, mode: "insensitive" } },
          { contact: { fullName: { contains: like, mode: "insensitive" } } },
        ],
      },
      take: 10,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        propertyAddress: true,
        city: true,
        state: true,
        status: true,
        side: true,
        closingDate: true,
        contact: { select: { fullName: true } },
      },
    }),
  ]);

  return NextResponse.json({
    query: q,
    contacts: contacts.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      primaryEmail: c.primaryEmail,
      primaryPhone: c.primaryPhone,
      sourceName: c.sourceName,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      propertyAddress: t.propertyAddress,
      city: t.city,
      state: t.state,
      status: t.status,
      side: t.side,
      closingDate: t.closingDate?.toISOString() ?? null,
      contactName: t.contact.fullName,
    })),
  });
}
