/**
 * POST /api/transactions/:id/pull-real-gci
 * Body: { realTransactionId? }
 *
 * Pull gross commission (and sale price / %) straight from Real and
 * write it into this deal's financials. Matches the deal to a Real
 * transaction by the stored rezenTransactionId, an explicit
 * realTransactionId, or by address. Ambiguous/no match → returns
 * candidates so the UI can let the user pick.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import {
  loadRealApiKey,
  listAgentTransactions,
  getRealGci,
  RealKeyError,
  type RealTxnLite,
} from "@/services/integrations/RealCommissionService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 30;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
/** Match if the street number + first street word both appear. */
function addressMatch(reos: string, real: string): boolean {
  const a = norm(reos);
  const b = norm(real);
  if (!a || !b) return false;
  const num = a.match(/^\d+/)?.[0];
  if (num && !b.startsWith(num)) return false;
  const aTokens = a.split(" ").filter((t) => t.length >= 3);
  const hit = aTokens.filter((t) => b.includes(t)).length;
  return hit >= Math.min(2, aTokens.length);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: {
      id: true,
      propertyAddress: true,
      rezenTransactionId: true,
      side: true,
      assignedUserId: true,
      restrictedToAssignee: true,
    },
  });
  if (!txn || !isDealVisible(actor, txn)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const key = await loadRealApiKey(prisma, actor.accountId);
  if (!key) {
    return NextResponse.json(
      { error: "Real isn't connected — add your Real API key in Settings → Real commission." },
      { status: 412 },
    );
  }

  let body: { realTransactionId?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* optional */
  }

  try {
    // Resolve which Real transaction to pull.
    let realTxnId = body.realTransactionId || txn.rezenTransactionId || null;
    let candidates: RealTxnLite[] = [];
    if (!realTxnId) {
      const all = await listAgentTransactions(key.apiKey, key.agentId);
      const matches = txn.propertyAddress
        ? all.filter((t) => addressMatch(txn.propertyAddress!, t.oneLine))
        : [];
      if (matches.length === 1) {
        realTxnId = matches[0].id;
      } else {
        candidates = matches.length > 0 ? matches : all;
        return NextResponse.json({
          ok: true,
          needsPick: true,
          candidates: candidates.slice(0, 25),
          message:
            matches.length === 0
              ? "No address match in your Real deals — pick the right one."
              : "Multiple matches — pick the right one.",
        });
      }
    }

    const gci = await getRealGci(key.apiKey, realTxnId);
    const pct =
      gci.saleCommissionPercent != null
        ? gci.saleCommissionPercent > 1
          ? gci.saleCommissionPercent
          : gci.saleCommissionPercent * 100
        : null;

    await prisma.transactionFinancials.upsert({
      where: { transactionId: txn.id },
      create: {
        transactionId: txn.id,
        salePrice: gci.salePrice,
        commissionPercent: pct,
        grossCommission: gci.grossCommission,
      },
      update: {
        ...(gci.salePrice != null ? { salePrice: gci.salePrice } : {}),
        ...(pct != null ? { commissionPercent: pct } : {}),
        ...(gci.grossCommission != null ? { grossCommission: gci.grossCommission } : {}),
      },
    });

    // Persist the Real link so next pull is direct.
    if (!txn.rezenTransactionId) {
      await prisma.transaction.update({
        where: { id: txn.id },
        data: { rezenTransactionId: realTxnId },
      });
    }

    return NextResponse.json({
      ok: true,
      pulled: {
        grossCommission: gci.grossCommission,
        salePrice: gci.salePrice,
        commissionPercent: pct,
        matchedAddress: gci.oneLine,
      },
    });
  } catch (e) {
    if (e instanceof RealKeyError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    logError(e, { route: "POST /api/transactions/[id]/pull-real-gci", transactionId: txn.id });
    return NextResponse.json({ error: "couldn't pull from Real" }, { status: 500 });
  }
}
