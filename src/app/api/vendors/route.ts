/**
 * GET /api/vendors?category=title|lender|inspector|attorney&q=search
 *
 * Returns contacts that have been participants on transactions in the
 * given role, grouped by contact, sorted by usage count desc.
 *
 * No separate "Vendor" model — we derive vendor-ness from
 * TransactionParticipant role. A contact is implicitly a "title
 * vendor" once they've appeared as role=title on any transaction.
 *
 * Response shape:
 *   { items: [
 *       {
 *         contactId, fullName, primaryEmail, primaryPhone,
 *         dealCount, lastUsedAt
 *       }
 *     ]
 *   }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

const VALID_ROLES = new Set([
  "title",
  "lender",
  "inspector",
  "attorney",
  "coordinator",
  "co_buyer",
  "co_seller",
  "other",
]);

export async function GET(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const url = new URL(req.url);
  const category = url.searchParams.get("category") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!VALID_ROLES.has(category)) {
    return NextResponse.json(
      {
        error: `category must be one of: ${[...VALID_ROLES].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Pull all participants for the role on THIS account's transactions,
  // then group in JS (simpler than raw SQL + still fast for < 10k rows).
  const parts = await prisma.transactionParticipant.findMany({
    where: {
      role: category,
      transaction: { accountId: actor.accountId },
    },
    include: {
      contact: {
        select: { id: true, fullName: true, primaryEmail: true, primaryPhone: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  interface Agg {
    contactId: string;
    fullName: string;
    primaryEmail: string | null;
    primaryPhone: string | null;
    dealCount: number;
    lastUsedAt: Date;
  }
  const byContact = new Map<string, Agg>();
  for (const p of parts) {
    const cur = byContact.get(p.contactId);
    if (cur) {
      cur.dealCount += 1;
      if (p.createdAt > cur.lastUsedAt) cur.lastUsedAt = p.createdAt;
    } else {
      byContact.set(p.contactId, {
        contactId: p.contactId,
        fullName: p.contact.fullName,
        primaryEmail: p.contact.primaryEmail,
        primaryPhone: p.contact.primaryPhone,
        dealCount: 1,
        lastUsedAt: p.createdAt,
      });
    }
  }

  let items = [...byContact.values()];

  // Filter by typed query (name/email/phone)
  if (q) {
    const ql = q.toLowerCase();
    items = items.filter((v) => {
      return (
        v.fullName.toLowerCase().includes(ql) ||
        (v.primaryEmail ?? "").toLowerCase().includes(ql) ||
        (v.primaryPhone ?? "").toLowerCase().includes(ql)
      );
    });
  }

  // Sort: most-used first, tiebreak most-recent
  items.sort((a, b) => {
    if (b.dealCount !== a.dealCount) return b.dealCount - a.dealCount;
    return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
  });

  return NextResponse.json({
    category,
    items: items.slice(0, 50),
  });
}
