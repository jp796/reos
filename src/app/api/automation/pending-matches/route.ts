import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export async function GET() {
  // Tenancy guard: scope to the actor's account. Prior implementation
  // used `prisma.account.findFirst()` which returns AN account —
  // whichever row Postgres feels like — so the pending queue mixed
  // tenants. See create-from-scan/route.ts for the canonical fix.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const account = { id: actor.accountId };

  const items = await prisma.pendingEmailMatch.findMany({
    where: { accountId: account.id, status: "pending" },
    orderBy: { detectedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ items });
}
