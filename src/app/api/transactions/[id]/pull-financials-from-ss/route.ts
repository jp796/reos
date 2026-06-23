/**
 * POST /api/transactions/:id/pull-financials-from-ss
 * Body: { documentId? }
 *
 * Pull sale price + gross commission from the deal's SETTLEMENT
 * STATEMENT and write them into financials. Source order:
 *   1. an explicit documentId (Files), or a clear SS doc in Files
 *   2. otherwise, search the deal's GMAIL for the SS attachment
 * Reuses DocumentExtractionService.extractFinancials (the same extractor
 * the auto-populate-on-closing flow uses). Returns candidates when the
 * Files SS is ambiguous.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import { DocumentExtractionService } from "@/services/ai/DocumentExtractionService";
import { gmailForAccount } from "@/services/integrations/gmailForAccount";

export const runtime = "nodejs";
export const maxDuration = 60;

const SS_RE = /settlement|closing disclosure|\balta\b|\bhud\b|\bcd\b|disbursement|seller'?s? net|buyer'?s? net/i;

/** Find the SS attachment bytes in the deal's Gmail, or null. */
async function findSsInGmail(
  db: import("@prisma/client").PrismaClient,
  accountId: string,
  address: string | null,
  contact: string | null,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const gmail = await gmailForAccount(db, accountId);
  if (!gmail) return null;
  const terms = [address, contact].filter(Boolean).map((t) => `"${String(t).replace(/["\\]/g, "")}"`);
  if (terms.length === 0) return null;
  const q = `newer_than:400d (${terms.join(" OR ")}) (settlement OR "closing disclosure" OR ALTA OR HUD OR disbursement OR "settlement statement") has:attachment`;
  let threads;
  try {
    ({ threads } = await gmail.searchThreadsPaged({ q, maxTotal: 8 }));
  } catch {
    return null;
  }
  for (const t of threads ?? []) {
    for (const m of t.messages ?? []) {
      if (!m.id) continue;
      let atts;
      try {
        atts = await gmail.getMessageAttachments(m.id);
      } catch {
        continue;
      }
      const hit = atts.find(
        (a) => /\.pdf$/i.test(a.filename) && SS_RE.test(a.filename),
      ) ?? atts.find((a) => /\.pdf$/i.test(a.filename));
      if (hit) {
        try {
          const buffer = await gmail.downloadAttachment(hit.messageId, hit.attachmentId);
          return { buffer, filename: hit.filename };
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: {
      id: true,
      side: true,
      propertyAddress: true,
      assignedUserId: true,
      restrictedToAssignee: true,
      contact: { select: { fullName: true } },
    },
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

  const side = txn.side === "buy" || txn.side === "sell" ? txn.side : null;
  let buffer: Buffer | null = null;
  let source = "";

  // 1. Files: explicit doc, or a clear SS doc.
  const docs = await prisma.document.findMany({
    where: { transactionId: txn.id },
    select: { id: true, fileName: true, category: true, rawBytes: true, uploadedAt: true },
    orderBy: { uploadedAt: "desc" },
  });
  const withBytes = docs.filter((d) => d.rawBytes);
  if (body.documentId) {
    const d = withBytes.find((x) => x.id === body.documentId);
    if (!d) return NextResponse.json({ error: "document not found" }, { status: 404 });
    buffer = Buffer.from(d.rawBytes as Buffer);
    source = d.fileName;
  } else {
    const ssMatches = withBytes.filter(
      (d) => d.category === "closing" || d.category === "settlement" || SS_RE.test(d.fileName),
    );
    if (ssMatches.length === 1) {
      buffer = Buffer.from(ssMatches[0].rawBytes as Buffer);
      source = ssMatches[0].fileName;
    } else if (ssMatches.length > 1) {
      return NextResponse.json({
        ok: true,
        needsPick: true,
        candidates: ssMatches.slice(0, 25).map((d) => ({ id: d.id, fileName: d.fileName })),
        message: "Multiple settlement-statement-like files — pick one.",
      });
    } else {
      // 2. Gmail fallback — the SS usually arrives by email.
      const found = await findSsInGmail(
        prisma,
        actor.accountId,
        txn.propertyAddress,
        txn.contact?.fullName ?? null,
      );
      if (found) {
        buffer = found.buffer;
        source = `${found.filename} (Gmail)`;
      } else if (withBytes.length > 0) {
        return NextResponse.json({
          ok: true,
          needsPick: true,
          candidates: withBytes.slice(0, 25).map((d) => ({ id: d.id, fileName: d.fileName })),
          message: "Couldn't find the settlement statement in Gmail — pick a file instead.",
        });
      } else {
        return NextResponse.json(
          {
            error:
              "No settlement statement found in Files or Gmail. Upload it to the Files tab, or make sure the closing email is in the connected Gmail.",
          },
          { status: 400 },
        );
      }
    }
  }

  let ex;
  try {
    ex = await new DocumentExtractionService().extractFinancials(buffer, side);
  } catch {
    return NextResponse.json({ error: "Couldn't read that document." }, { status: 502 });
  }
  if (!ex || (!ex.salePrice && !ex.grossCommission)) {
    return NextResponse.json(
      { error: `No sale price or commission found in "${source}". Make sure it's the final settlement statement / CD.` },
      { status: 422 },
    );
  }

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
      source,
      commissionInferredHalf: ex.commissionInferredHalf ?? false,
    },
  });
}
