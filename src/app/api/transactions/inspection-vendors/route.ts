/**
 * GET /api/transactions/inspection-vendors
 *
 * Returns the distinct list of inspection vendor names used on the
 * caller's account, sorted by most-recent-use. Powers the vendor
 * autocomplete on the InspectionsPanel — once a TC types "Acme
 * Inspections" on one deal, it pre-fills on every future one.
 *
 * Account-scoped: only vendors from this caller's transactions are
 * returned, never another tenant's roster.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  // Pull every inspection in this account whose vendorName is set.
  // Group by vendorName, take MAX(updatedAt) so we can sort by
  // recency. Cap at 50 — typical TC has a handful of regulars.
  const rows = await prisma.transactionInspection.groupBy({
    by: ["vendorName"],
    where: {
      vendorName: { not: null },
      transaction: { accountId: actor.accountId },
    },
    _max: { updatedAt: true },
    _count: { _all: true },
    orderBy: { _max: { updatedAt: "desc" } },
    take: 50,
  });

  return NextResponse.json({
    ok: true,
    vendors: rows
      .filter((r) => r.vendorName)
      .map((r) => ({
        name: r.vendorName!,
        usedCount: r._count?._all ?? 0,
        lastUsedAt: r._max?.updatedAt?.toISOString() ?? null,
      })),
  });
}
