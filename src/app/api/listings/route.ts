/**
 * POST /api/listings
 *
 * Creates a new listing — under the hood, a Transaction with
 * status='listing', side='sell', a placeholder seller-side
 * earnest_money milestone is NOT created here (those come post-
 * contract). Returns the created transaction id so the client
 * can navigate to it.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

interface Body {
  sellerName: string;
  sellerEmail?: string;
  sellerPhone?: string;
  propertyAddress: string;
  city?: string;
  state?: string;
  zip?: string;
  listPrice?: number | null;
  listDate?: string;
  listingExpirationDate?: string;
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.sellerName?.trim() || !body?.propertyAddress?.trim()) {
    return NextResponse.json(
      { error: "sellerName and propertyAddress required" },
      { status: 400 },
    );
  }

  // Find or create seller contact
  let contact = body.sellerEmail
    ? await prisma.contact.findFirst({
        where: {
          accountId: actor.accountId,
          primaryEmail: { equals: body.sellerEmail, mode: "insensitive" },
        },
        select: { id: true },
      })
    : null;
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        accountId: actor.accountId,
        fullName: body.sellerName.trim().slice(0, 200),
        primaryEmail: body.sellerEmail?.trim() || null,
        primaryPhone: body.sellerPhone?.trim() || null,
        sourceName: "manual-listing-create",
      },
      select: { id: true },
    });
  }

  const txn = await prisma.transaction.create({
    data: {
      accountId: actor.accountId,
      contactId: contact.id,
      assignedUserId: actor.userId,
      status: "listing",
      side: "sell",
      transactionType: "seller",
      propertyAddress: body.propertyAddress.trim().slice(0, 240),
      city: body.city?.trim() || null,
      state: body.state?.trim().toUpperCase() || null,
      zip: body.zip?.trim() || null,
      listPrice: body.listPrice ?? null,
      listDate: body.listDate ? new Date(body.listDate) : new Date(),
      listingExpirationDate: body.listingExpirationDate
        ? new Date(body.listingExpirationDate)
        : null,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: txn.id });
}
