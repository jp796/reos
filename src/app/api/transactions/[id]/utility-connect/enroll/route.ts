/**
 * POST /api/transactions/:id/utility-connect/enroll
 *
 * Manually enroll the buyer in Utility Connect. Idempotent — the
 * service refuses to re-enroll a transaction that already has a
 * utilityConnectLeadId. Useful when the cron's 7-10 day window
 * doesn't fit (rush deals, late starts).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { enrollTransactionInUtilityConnect } from "@/services/automation/UtilityConnectEnrollment";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: { contact: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  try {
    const result = await enrollTransactionInUtilityConnect(prisma, txn, {
      agentEmail: actor.email ?? undefined,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason ?? "enrollment failed" },
        { status: 400 },
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    logError(e, {
      route: "/api/transactions/:id/utility-connect/enroll",
      transactionId: id,
      accountId: txn.accountId,
      userId: actor.userId,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "enrollment failed" },
      { status: 500 },
    );
  }
}
