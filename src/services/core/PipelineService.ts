/**
 * PipelineService — the "$ Pipeline" income dashboard.
 *
 * Merges two income sources into one running list, mirroring JP's original
 * spreadsheet tab but live:
 *   1. AUTO lines — derived from REOS deals with commission financials
 *      (netCommission ?? grossCommission ?? salePrice × rate).
 *   2. MANUAL lines — hand-entered rows (off-system deals, wholesale fees,
 *      flip proceeds, projections/"guesses").
 *
 * A manual row linked to a transaction suppresses that deal's auto line so
 * income is never double-counted.
 */

import type { PrismaClient } from "@prisma/client";

export type IncomeStatus = "contracted" | "guess";
export type IncomeSource = "auto" | "manual";

export interface PipelineRow {
  id: string;
  source: IncomeSource;
  business: string;
  property: string;
  disposition: string;
  expectedIncome: number;
  expectedDate: string | null; // ISO
  status: IncomeStatus;
  note: string | null;
  transactionId: string | null;
}

export interface PipelineTotals {
  grandTotal: number;
  contractedTotal: number;
  guessTotal: number;
  count: number;
  byBusiness: Array<{ business: string; total: number }>;
}

/** Which side of the business a deal's income belongs to. */
export function businessFor(transactionType: string | null): string {
  return transactionType === "investor" || transactionType === "wholesale"
    ? "EPS"
    : "RE Agent";
}

/** Human disposition label from the deal type. */
export function dispositionFor(transactionType: string | null): string {
  switch (transactionType) {
    case "buyer":
      return "Client Purchase";
    case "seller":
      return "Client Sale";
    case "investor":
      return "Flip Sale";
    case "wholesale":
      return "Wholesale";
    default:
      return "Other";
  }
}

/** Under-contract (or done) deals are "contracted"; pre-contract listings
 *  are projected "guess" income. */
export function statusForDeal(dealStatus: string): IncomeStatus {
  return dealStatus === "listing" ? "guess" : "contracted";
}

/**
 * Expected income for a deal from its commission financials. Returns null when
 * there's nothing to show (no proceeds figure) so the deal is skipped.
 * commissionPercent is normalized: a value > 1 is treated as a percent (3 → 3%),
 * ≤ 1 as a fraction (0.03 → 3%).
 */
export function computeAutoIncome(fin: {
  netCommission?: number | null;
  grossCommission?: number | null;
  salePrice?: number | null;
  commissionPercent?: number | null;
} | null): number | null {
  if (!fin) return null;
  if (fin.netCommission != null && fin.netCommission > 0) return fin.netCommission;
  if (fin.grossCommission != null && fin.grossCommission > 0) return fin.grossCommission;
  if (fin.salePrice != null && fin.salePrice > 0 && fin.commissionPercent != null && fin.commissionPercent > 0) {
    const rate = fin.commissionPercent > 1 ? fin.commissionPercent / 100 : fin.commissionPercent;
    return fin.salePrice * rate;
  }
  return null;
}

/** Roll up rows into the dashboard totals. */
export function computeTotals(rows: PipelineRow[]): PipelineTotals {
  let grandTotal = 0;
  let contractedTotal = 0;
  let guessTotal = 0;
  const byBiz = new Map<string, number>();
  for (const r of rows) {
    grandTotal += r.expectedIncome;
    if (r.status === "contracted") contractedTotal += r.expectedIncome;
    else guessTotal += r.expectedIncome;
    byBiz.set(r.business, (byBiz.get(r.business) ?? 0) + r.expectedIncome);
  }
  return {
    grandTotal,
    contractedTotal,
    guessTotal,
    count: rows.length,
    byBusiness: [...byBiz.entries()]
      .map(([business, total]) => ({ business, total }))
      .sort((a, b) => b.total - a.total),
  };
}

export interface Pipeline {
  rows: PipelineRow[];
  totals: PipelineTotals;
}

/** Build the merged, sorted pipeline for an account (auto ∪ manual). */
export async function getPipeline(
  db: PrismaClient,
  accountId: string,
): Promise<Pipeline> {
  const [manual, deals] = await Promise.all([
    db.pipelineIncomeItem.findMany({ where: { accountId } }),
    db.transaction.findMany({
      where: {
        accountId,
        isDemo: false,
        status: { notIn: ["dead", "terminated"] },
      },
      select: {
        id: true,
        propertyAddress: true,
        transactionType: true,
        status: true,
        closingDate: true,
        financials: {
          select: {
            netCommission: true,
            grossCommission: true,
            salePrice: true,
            commissionPercent: true,
          },
        },
      },
    }),
  ]);

  // Manual rows first; collect the deals they already cover.
  const covered = new Set<string>();
  const manualRows: PipelineRow[] = manual.map((m) => {
    if (m.transactionId) covered.add(m.transactionId);
    return {
      id: m.id,
      source: "manual",
      business: m.business,
      property: m.property,
      disposition: m.disposition,
      expectedIncome: m.expectedIncome,
      expectedDate: m.expectedDate?.toISOString() ?? null,
      status: m.status === "contracted" ? "contracted" : "guess",
      note: m.note,
      transactionId: m.transactionId,
    };
  });

  const autoRows: PipelineRow[] = [];
  for (const d of deals) {
    if (covered.has(d.id)) continue; // a manual line overrides this deal
    const income = computeAutoIncome(d.financials);
    if (income == null) continue;
    autoRows.push({
      id: `auto:${d.id}`,
      source: "auto",
      business: businessFor(d.transactionType),
      property: d.propertyAddress ?? "(no address)",
      disposition: dispositionFor(d.transactionType),
      expectedIncome: income,
      expectedDate: d.closingDate?.toISOString() ?? null,
      status: statusForDeal(d.status),
      note: null,
      transactionId: d.id,
    });
  }

  const rows = [...manualRows, ...autoRows].sort((a, b) => {
    // Nearest expected date first; undated rows sink to the bottom.
    const ad = a.expectedDate ? Date.parse(a.expectedDate) : Number.POSITIVE_INFINITY;
    const bd = b.expectedDate ? Date.parse(b.expectedDate) : Number.POSITIVE_INFINITY;
    return ad - bd;
  });

  return { rows, totals: computeTotals(rows) };
}
