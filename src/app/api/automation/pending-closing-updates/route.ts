import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await prisma.pendingClosingDateUpdate.findMany({
    where: { status: "pending" },
    orderBy: { detectedAt: "desc" },
    take: 50,
    include: {
      account: { select: { id: true } },
    },
  });
  const txnIds = Array.from(new Set(items.map((i) => i.transactionId)));
  const txns = await prisma.transaction.findMany({
    where: { id: { in: txnIds } },
    include: { contact: { select: { fullName: true } } },
  });
  const byId = new Map(txns.map((t) => [t.id, t]));
  return NextResponse.json({
    items: items.map((i) => ({
      id: i.id,
      transactionId: i.transactionId,
      contactName: byId.get(i.transactionId)?.contact.fullName ?? "—",
      propertyAddress: byId.get(i.transactionId)?.propertyAddress ?? null,
      documentType: i.documentType,
      anchor: i.anchor,
      extractedDate: i.extractedDate.toISOString(),
      previousDate: i.previousDate?.toISOString() ?? null,
      proposedStage: i.proposedStage,
      side: i.side,
      confidence: i.confidence,
      snippet: i.snippet,
      detectedAt: i.detectedAt.toISOString(),
    })),
  });
}
