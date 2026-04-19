/**
 * POST /api/automation/pending-closing-updates/cleanup-low-confidence
 *
 * Bulk-ignore pending closing-date updates that are almost certainly
 * parsing artifacts:
 *   - confidence < 0.85
 *   - OR extracted_date lands on a template-looking date (e.g. Jan 1,
 *     Jan 2, or the first of any month), which Settlement Statement
 *     boilerplate often produces when the real date couldn't be parsed
 *
 * Never touches FUB. Local-only cleanup.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const TEMPLATE_SUSPECT_DATES = new Set([
  // MM-DD pairs that SS boilerplate tends to produce as false positives
  "01-01",
  "12-31",
]);

export async function POST() {
  const rows = await prisma.pendingClosingDateUpdate.findMany({
    where: { status: "pending" },
    select: { id: true, confidence: true, extractedDate: true },
  });

  const toIgnore: string[] = [];
  for (const r of rows) {
    const mmdd =
      String(r.extractedDate.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(r.extractedDate.getDate()).padStart(2, "0");
    if (r.confidence < 0.85) {
      toIgnore.push(r.id);
      continue;
    }
    if (TEMPLATE_SUSPECT_DATES.has(mmdd)) {
      toIgnore.push(r.id);
    }
  }

  if (toIgnore.length === 0) {
    return NextResponse.json({ ok: true, ignored: 0, remaining: rows.length });
  }

  const res = await prisma.pendingClosingDateUpdate.updateMany({
    where: { id: { in: toIgnore } },
    data: { status: "ignored", appliedAt: null },
  });

  return NextResponse.json({
    ok: true,
    ignored: res.count,
    remaining: rows.length - res.count,
  });
}
