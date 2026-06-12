/**
 * Sender-side page images for the field-placement editor.
 *
 *   GET ?documentId=X&meta=1   → { pageCount }
 *   GET ?documentId=X&page=N   → image/png of page N
 *
 * Session-gated and account-scoped (this is the private side of
 * esign — the public signer equivalent lives at /api/sign/[token]).
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { pdfPageCount } from "@/services/ai/PdfRender";
import { renderPdfPage } from "@/services/esign/EsignPdfService";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId") ?? "";
  if (!documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }

  // Account scoping: the document must belong to a transaction in
  // the actor's account.
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      transactionId: id,
      transaction: { accountId: actor.accountId },
    },
    select: { rawBytes: true, mimeType: true },
  });
  if (!doc?.rawBytes || doc.mimeType !== "application/pdf") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const buffer = Buffer.from(doc.rawBytes);

  if (url.searchParams.get("meta") === "1") {
    const pageCount = (await pdfPageCount(buffer)) ?? 1;
    return NextResponse.json({ pageCount });
  }

  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  if (!Number.isInteger(page) || page < 1 || page > 500) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  const png = await renderPdfPage(buffer, page);
  if (!png) return NextResponse.json({ error: "render failed" }, { status: 500 });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
