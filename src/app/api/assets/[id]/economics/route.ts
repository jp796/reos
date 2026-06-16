/**
 * PATCH /api/assets/:id/economics — save the raw economics input bag for
 * an Asset (spec §9). Stored on Asset.economicsJson; the deal page and
 * Production rollup recompute derived metrics from it via
 * DealEconomicsService.economicsFromBag().
 *
 * Body: a flat object of the known input keys (numbers, or ISO date
 * strings for the *Date keys). Unknown keys are dropped. Sending the
 * full bag replaces what's stored.
 *
 * Tenancy: the Asset must belong to the caller's account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

// Union of every strategy's input keys (DealEconomicsService).
const NUMBER_KEYS = new Set([
  // flip
  "purchasePrice", "rehabBudget", "holdingCosts", "buyingCosts", "salePrice", "sellingCosts",
  // wholesale
  "assignmentFee", "emd",
  // rental / BRRRR
  "monthlyRent", "monthlyDebtService", "monthlyTaxes", "monthlyInsurance", "monthlyMgmt",
  "monthlyMaintenance", "monthlyOtherOpex", "allInCost", "totalInvested", "cashOutRefi",
  // creative
  "incomingMonthlyPayment", "underlyingMonthlyPayment", "monthlyExpenses", "entryCost", "expectedExitValue",
  // retail
  "commissionPercent", "grossCommission", "referralFee", "brokerageSplit",
]);
const DATE_KEYS = new Set([
  "purchaseDate", "saleDate", "contractDate", "assignedDate", "balloonDate",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const asset = await prisma.asset.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Sanitize: keep only known keys; numbers parsed, dates kept as ISO
  // strings, blanks dropped.
  const bag: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v == null || v === "") continue;
    if (NUMBER_KEYS.has(k)) {
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,$\s%]/g, ""));
      if (Number.isFinite(n)) bag[k] = n;
    } else if (DATE_KEYS.has(k)) {
      const s = String(v);
      if (!Number.isNaN(new Date(s).getTime())) bag[k] = s;
    }
  }

  await prisma.asset.update({
    where: { id: asset.id },
    data: { economicsJson: bag as Prisma.InputJsonValue },
  });
  return NextResponse.json({ ok: true, economics: bag });
}
