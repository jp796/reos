/**
 * POST /api/automation/pending-closing-updates/dedupe
 *
 * When we scan a thread with multiple SS revisions (draft → revised
 * → final), each version creates a separate pending row. This
 * endpoint collapses duplicates: per transaction_id, keep only the
 * row with the LATEST extracted_date (the final SS); mark the rest
 * as ignored with reason="superseded_by_later_ss".
 *
 * Idempotent: running it repeatedly on a clean queue is a no-op.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  const pending = await prisma.pendingClosingDateUpdate.findMany({
    where: { status: "pending" },
    orderBy: [{ transactionId: "asc" }, { extractedDate: "desc" }],
  });

  // Group per (transactionId, side). Keep the first (latest extracted
  // date because of the sort above); supersede the rest.
  const keeperIds = new Set<string>();
  const supersedeIds: string[] = [];

  const seen = new Map<string, string>(); // key -> kept id
  for (const row of pending) {
    const key = `${row.transactionId}::${row.side ?? "unknown"}`;
    const already = seen.get(key);
    if (!already) {
      seen.set(key, row.id);
      keeperIds.add(row.id);
    } else {
      supersedeIds.push(row.id);
    }
  }

  if (supersedeIds.length > 0) {
    await prisma.pendingClosingDateUpdate.updateMany({
      where: { id: { in: supersedeIds } },
      data: { status: "ignored" },
    });
  }

  return NextResponse.json({
    ok: true,
    inspected: pending.length,
    kept: keeperIds.size,
    superseded: supersedeIds.length,
  });
}
