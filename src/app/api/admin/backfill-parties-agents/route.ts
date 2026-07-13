/**
 * POST /api/admin/backfill-parties-agents
 *
 * Layer 1 backfill: for every transaction in the ACTOR'S account, persist the
 * full party + agent set from the contract's stored analysis baseline (all
 * sellers, both sides' agents with email/phone/brokerage). Idempotent and
 * enrich-only, so it's safe to run repeatedly. Reads only what was already
 * extracted — no re-extraction, no token cost.
 *
 * Owner-only + tenant-scoped. Returns per-deal + aggregate counts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import {
  persistPartiesAndAgents,
  type ExtractionLike,
} from "@/services/core/PartyAgentPersistenceService";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role && actor.role !== "owner" && actor.role !== "admin") {
    return NextResponse.json({ error: "owner/admin only" }, { status: 403 });
  }

  const txns = await prisma.transaction.findMany({
    where: { accountId: actor.accountId },
    select: { id: true, propertyAddress: true },
  });

  const totals = { coBuyers: 0, coSellers: 0, agents: 0, enriched: 0 };
  let withBaseline = 0;
  let withAgents = 0;
  let changed = 0;
  const changedDeals: string[] = [];

  for (const t of txns) {
    const docs = await prisma.document.findMany({
      where: { transactionId: t.id },
      select: { analysisJson: true },
    });
    let baseline: Record<string, unknown> | null = null;
    for (const d of docs) {
      const a = d.analysisJson as { docType?: string; baseline?: Record<string, unknown> } | null;
      if (a?.docType === "purchase_contract" && a.baseline) {
        baseline = a.baseline;
        break;
      }
      if (a?.baseline && !baseline) baseline = a.baseline;
    }
    if (!baseline) continue;
    withBaseline++;
    const agentsVal = (baseline as { agents?: { value?: unknown[] } }).agents?.value;
    if (Array.isArray(agentsVal) && agentsVal.length > 0) withAgents++;

    const r = await persistPartiesAndAgents(
      prisma,
      actor.accountId,
      t.id,
      baseline as unknown as ExtractionLike,
    );
    totals.coBuyers += r.coBuyersAdded;
    totals.coSellers += r.coSellersAdded;
    totals.agents += r.agentsAdded;
    totals.enriched += r.contactsEnriched;
    if (r.coBuyersAdded + r.coSellersAdded + r.agentsAdded + r.contactsEnriched > 0) {
      changed++;
      if (t.propertyAddress) changedDeals.push(t.propertyAddress);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: txns.length,
    withBaseline,
    withAgentsInBaseline: withAgents,
    changed,
    totals,
    changedDeals: changedDeals.slice(0, 50),
    summary: `Backfilled ${changed} deal(s): +${totals.coBuyers} co-buyers, +${totals.coSellers} co-sellers, +${totals.agents} agents, ${totals.enriched} contacts enriched (from ${withBaseline} deals with a contract baseline; ${withAgents} had agents extracted).`,
  });
}
