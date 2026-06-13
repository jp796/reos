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
import { parseInputDate } from "@/lib/dates";

export const runtime = "nodejs";

interface Body {
  sellerName: string;
  sellerEmail?: string;
  sellerPhone?: string;
  /** Existing contact id when the seller was picked from the
   *  contact typeahead. When set, link it instead of creating a
   *  duplicate. */
  sellerContactId?: string | null;
  /** Optional second seller (spouse / co-owner / second trustee).
   *  Becomes their own Contact + a co_seller TransactionParticipant
   *  so eSign can route a separate signature to them. */
  seller2Name?: string;
  seller2Email?: string;
  seller2Phone?: string;
  seller2ContactId?: string | null;
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

  // Resolve the seller contact, in priority order:
  //   1. explicit contact id from the typeahead (must be in tenant)
  //   2. existing contact matched by email
  //   3. create a new one
  let contact: { id: string } | null = null;
  if (body.sellerContactId) {
    contact = await prisma.contact.findFirst({
      where: { id: body.sellerContactId, accountId: actor.accountId },
      select: { id: true },
    });
  }
  if (!contact && body.sellerEmail) {
    contact = await prisma.contact.findFirst({
      where: {
        accountId: actor.accountId,
        primaryEmail: { equals: body.sellerEmail, mode: "insensitive" },
      },
      select: { id: true },
    });
  }
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
      listDate: body.listDate ? parseInputDate(body.listDate) ?? new Date() : new Date(),
      listingExpirationDate: body.listingExpirationDate
        ? parseInputDate(body.listingExpirationDate) ?? new Date()
        : null,
    },
    select: { id: true },
  });

  // Second seller → own Contact + co_seller participant. Kept
  // separate from the primary contact so eSign can route an
  // individual signature and Gmail enrichment can target their
  // own inbox. Failure here never rolls back the listing — the
  // user can re-add the co-seller from the transaction page.
  if (body.seller2Name?.trim()) {
    try {
      let contact2: { id: string } | null = null;
      if (body.seller2ContactId) {
        contact2 = await prisma.contact.findFirst({
          where: { id: body.seller2ContactId, accountId: actor.accountId },
          select: { id: true },
        });
      }
      if (!contact2 && body.seller2Email?.trim()) {
        contact2 = await prisma.contact.findFirst({
          where: {
            accountId: actor.accountId,
            primaryEmail: {
              equals: body.seller2Email.trim(),
              mode: "insensitive",
            },
          },
          select: { id: true },
        });
      }
      if (!contact2) {
        contact2 = await prisma.contact.create({
          data: {
            accountId: actor.accountId,
            fullName: body.seller2Name.trim().slice(0, 200),
            primaryEmail: body.seller2Email?.trim() || null,
            primaryPhone: body.seller2Phone?.trim() || null,
            sourceName: "manual-listing-create",
          },
          select: { id: true },
        });
      }
      await prisma.transactionParticipant.create({
        data: {
          transactionId: txn.id,
          contactId: contact2.id,
          role: "co_seller",
        },
      });
    } catch (e) {
      console.warn("listing co-seller create failed (non-fatal):", e);
    }
  }

  return NextResponse.json({ ok: true, id: txn.id });
}
