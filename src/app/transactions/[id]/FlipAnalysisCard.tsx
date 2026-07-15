/**
 * FlipAnalysisCard — the saved Flip Analysis for a deal, surfaced on its page.
 * Loads the latest FlipAnalysis, recomputes all four exit scenarios via
 * FlipCalcModel (never stores outputs), and shows the headline economics with
 * a link to open the full calculator. Renders nothing when the deal has no
 * saved analysis.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeFlip, type FlipInputs } from "@/services/core/FlipCalcModel";

const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();

export async function FlipAnalysisCard({
  transactionId,
  accountId,
}: {
  transactionId: string;
  accountId: string;
}) {
  const a = await prisma.flipAnalysis.findFirst({
    where: { transactionId, accountId },
    orderBy: { updatedAt: "desc" },
    select: { label: true, inputsJson: true },
  });
  if (!a) return null;

  const inputs = a.inputsJson as unknown as FlipInputs;
  let r;
  try {
    r = computeFlip(inputs);
  } catch {
    return null;
  }
  const ff = r.fixFlip;

  const exits: Array<{ name: string; value: number; sub: string }> = [
    { name: "Fix & Flip", value: ff.profit, sub: `ARV ${money(ff.arv)}` },
    { name: "Wholetail", value: r.wholetail.profit, sub: `ARV ${money(r.wholetail.arv)}` },
    { name: "DSCR Rental", value: r.rental.totalProfit3yr, sub: `${money(r.rental.monthlyCashflow)}/mo` },
    { name: "Owner Finance", value: r.ownerFinance.totalProfit3yr, sub: "3-yr payday" },
  ];
  const best = exits.reduce((a, b) => (b.value > a.value ? b : a));

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Flip Analysis</h3>
          <p className="text-[11px] text-text-subtle">{a.label}</p>
        </div>
        <Link
          href={`/flip-calculator?transactionId=${transactionId}`}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:border-brand-300 hover:text-brand-700"
        >
          Open calculator
        </Link>
      </div>

      {/* Fix & Flip headline */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Stat label="Offer" value={money(inputs.offerPrice)} />
        <Stat label="ARV" value={money(ff.arv)} />
        <Stat label="Rehab" value={money(inputs.flipRehabBudget)} />
        <Stat label="Projected profit" value={money(ff.profit)} tone={ff.profit >= 0 ? "good" : "bad"} big />
        <Stat label="Max offer · $50k" value={money(ff.maxOfferForProfit)} />
        <Stat label="Max offer · 70% LTV" value={money(ff.maxOffer70Ltv)} />
        <Stat label="Break-even offer" value={money(ff.breakEvenOffer)} />
        <Stat label="Hold" value={`${inputs.flipHoldingMonths} mo`} />
      </div>

      {/* Exit comparison */}
      <div className="mt-3 border-t border-border pt-3">
        <div className="reos-label mb-2 text-text-subtle">Exit strategies · best: {best.name}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {exits.map((e) => (
            <div
              key={e.name}
              className={`rounded-md border p-2 ${e.name === best.name ? "border-brand-200 bg-brand-50/50 dark:bg-brand-950/20" : "border-border"}`}
            >
              <div className="text-[11px] text-text-muted">{e.name}</div>
              <div className={`text-sm font-semibold tabular-nums ${e.value >= 0 ? "text-text" : "text-red-600 dark:text-red-400"}`}>
                {money(e.value)}
              </div>
              <div className="text-[10px] text-text-subtle">{e.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
  big?: boolean;
}) {
  return (
    <div>
      <div className="reos-label text-text-subtle">{label}</div>
      <div
        className={`tabular-nums ${big ? "text-lg font-bold" : "text-sm font-medium"} ${
          tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : "text-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
