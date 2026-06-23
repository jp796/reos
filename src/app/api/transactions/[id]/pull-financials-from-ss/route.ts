/**
 * POST /api/transactions/:id/pull-financials-from-ss
 * Body: { documentId? }
 *
 * Pull sale price + gross commission from the deal's SETTLEMENT
 * STATEMENT (a document in the Files library) and write them into
 * financials. Reuses DocumentExtractionService.extractFinancials (the
 * same extractor the auto-populate-on-closing flow uses). If multiple
 * candidate docs exist and none is clearly the SS, returns candidates
 * so the UI can pick.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import { DocumentExtractionService } from "@/services/ai/DocumentExtractionService";

export const runtime = "nodejs";
export const maxDuration = 60;

const SS_RE = /settlement|closing disclosure|\balta\b|\bhud\b|\bcd\b|disbursement|seller'?s? net|buyer'?s? net/i;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true, side: true, assignedUserId: true, restrictedToAssignee: true },
  });
  if (!txn || !isDealVisible(actor, txn)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { documentId?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* optional */
  }

  // Candidate docs: PDFs with stored bytes on this deal.
  const docs = await prisma.document.findMany({
    where: { transactionId: txn.id },
    select: { id: true, fileName: true, category: true, mimeType: true, rawBytes: true, uploadedAt: true },
    orderBy: { uploadedAt: "desc" },
  });
  const withBytes = docs.filter((d) => d.rawBytes);
  if (withBytes.length === 0) {
    return NextResponse.json(
      { error: "No documents on this deal. Upload the settlement statement to the Files tab first." },
      { status: 400 },
    );
  }

  // Resolve which document to read.
  let chosen = body.documentId ? withBytes.find((d) => d.id === body.documentId) : undefined;
  if (!chosen) {
    const ssMatches = withBytes.filter(
      (d) => d.category === "closing" || d.category === "settlement" || SS_RE.test(d.fileName),
    );
    if (ssMatches.length === 1) {
      chosen = ssMatches[0];
    } else if (ssMatches.length === 0 && withBytes.length === 1) {
      chosen = withBytes[0];
    } else {
      return NextResponse.json({
        ok: true,
        needsPick: true,
        candidates: (ssMatches.length ? ssMatches : withBytes)
          .slice(0, 25)
          .map((d) => ({ id: d.id, fileName: d.fileName })),
        message:
          ssMatches.length === 0
            ? "Couldn't spot a settlement statement — pick the document to read."
            : "Multiple settlement-statement-like docs — pick one.",
      });
    }
  }

  const side = txn.side === "buy" || txn.side === "sell" ? txn.side : null;
  let ex;
  try {
    ex = await new DocumentExtractionService().extractFinancials(
      Buffer.from(chosen.rawBytes as Buffer),
      side,
    );
  } catch {
    return NextResponse.json({ error: "Couldn't read that document." }, { status: 502 });
  }
  if (!ex || (!ex.salePrice && !ex.grossCommission)) {
    return NextResponse.json(
      { error: `No sale price or commission found in "${chosen.fileName}". Make sure it's the final settlement statement / CD.` },
      { status: 422 },
    );
  }

  // Mirror FinancialsAutoPopulate: a referral embedded in the SS line is
  // added back so grossCommission = full broker comp, referral tracked.
  let gross = ex.grossCommission ?? null;
  let referralFeeAmount: number | null = null;
  if (ex.referralEmbedded && gross !== null) {
    referralFeeAmount = ex.referralEmbedded;
    gross = Math.round((gross + ex.referralEmbedded) * 100) / 100;
  } else if (ex.referralEmbedded) {
    referralFeeAmount = ex.referralEmbedded;
  }

  await prisma.transactionFinancials.upsert({
    where: { transactionId: txn.id },
    create: {
      transactionId: txn.id,
      salePrice: ex.salePrice ?? null,
      grossCommission: gross,
      referralFeeAmount,
    },
    update: {
      ...(ex.salePrice != null ? { salePrice: ex.salePrice } : {}),
      ...(gross != null ? { grossCommission: gross } : {}),
      ...(referralFeeAmount != null ? { referralFeeAmount } : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    pulled: {
      salePrice: ex.salePrice ?? null,
      grossCommission: gross,
      referralFeeAmount,
      source: chosen.fileName,
      commissionInferredHalf: ex.commissionInferredHalf ?? false,
    },
  });
}
