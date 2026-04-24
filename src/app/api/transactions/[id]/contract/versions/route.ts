/**
 * GET /api/transactions/:id/contract/versions
 *
 * Returns the extraction history for a transaction + the CURRENT
 * pending extraction as the most-recent "version" for diffing.
 *
 * Response:
 *   {
 *     versions: [
 *       { id, source, filename, sourceDate, fieldCount, isCurrent },
 *       ...ordered newest first
 *     ],
 *     current: pendingContractJson (or null)
 *   }
 *
 * Diffing is computed client-side from the full JSON — keeps the
 * server stateless. Full JSON for a specific version fetched via
 * /versions/:vid.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: {
      accountId: true,
      pendingContractJson: true,
      contractExtractedAt: true,
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const versions = await prisma.contractExtractionVersion.findMany({
    where: { transactionId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      source: true,
      filename: true,
      sourceDate: true,
      createdAt: true,
      extractionJson: true,
    },
  });

  return NextResponse.json({
    current: txn.pendingContractJson,
    currentSourceDate: txn.contractExtractedAt,
    versions: versions.map((v) => ({
      id: v.id,
      source: v.source,
      filename: v.filename,
      sourceDate: v.sourceDate,
      createdAt: v.createdAt,
      extraction: v.extractionJson,
    })),
  });
}
