/**
 * POST /api/transactions/:id/synthesize
 * Body: { force?: boolean }
 *
 * Document-Set Synthesis: read EVERY document on the deal together —
 * contract plus every addendum, amendment, inspection notice, and
 * disclosure — and rebuild the deal's CURRENT picture: merged timeline
 * dates, contingency statuses (e.g. inspection removed), and
 * auto-completing the milestones/tasks those resolved contingencies
 * cover. Unlike contract/rescan (contract-only), this reconciles the
 * whole document set.
 *
 * Per-document AI reads and the contract baseline are cached on each
 * doc (PDFs are immutable), so re-running only analyzes NEW documents —
 * making the on-upload trigger fast and the result consistent.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { synthesizeDeal } from "@/services/core/DocumentSynthesisService";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };

  try {
    const result = await synthesizeDeal(
      prisma,
      txn.accountId,
      txn.id,
      body.force === true,
    );
    if (!result) {
      return NextResponse.json({ error: "deal not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        error: "synthesis failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
