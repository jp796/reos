import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) return NextResponse.json({ items: [] });

  const items = await prisma.pendingEmailMatch.findMany({
    where: { accountId: account.id, status: "pending" },
    orderBy: { detectedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ items });
}
