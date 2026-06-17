/**
 * /board — the investment kanban (Monday.com-style). Investor deals as
 * cards in stage columns; drag a card to advance its stage. Investment
 * (principal) deals ONLY — retail never appears here. Gated to the
 * investor entitlement and filtered by per-deal visibility.
 */

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { readEntitlements } from "@/lib/entitlements";
import { dealVisibilityWhere } from "@/lib/deal-visibility";
import {
  getStrategyTemplate,
  STRATEGY_TEMPLATES,
} from "@/services/core/strategyTemplates";
import {
  economicsFromBag,
  headlineMetric,
} from "@/services/core/DealEconomicsService";
import type { Strategy } from "@/services/core/DealClassifierService";
import { BoardClient } from "./BoardClient";

export const dynamic = "force-dynamic";

const STRATEGIES: Strategy[] = ["flip", "wholesale", "rental_brrrr", "creative"];
const LABEL: Record<string, string> = {
  flip: "Flip",
  wholesale: "Wholesale",
  rental_brrrr: "Rental / BRRRR",
  creative: "Creative",
};

function money(n: number | null | undefined) {
  return n == null
    ? null
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ strategy?: string }>;
}) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) redirect("/login");

  // Investor-entitlement gate.
  const entitlements = await readEntitlements(actor.accountId);
  if (!entitlements.includes("investor")) redirect("/transactions");

  // All investment (principal) deals the actor may see.
  const rows = await prisma.transaction.findMany({
    where: {
      accountId: actor.accountId,
      ...dealVisibilityWhere(actor),
      asset: { representation: "principal" },
      status: { notIn: ["dead"] },
    },
    select: {
      id: true,
      propertyAddress: true,
      closingDate: true,
      contact: { select: { fullName: true } },
      assignedUser: { select: { name: true } },
      asset: {
        select: { id: true, strategy: true, currentStageName: true, economicsJson: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Per-strategy counts for the tabs.
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const s = r.asset?.strategy ?? "";
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }

  const sp = await searchParams;
  const strategy: Strategy =
    sp.strategy && STRATEGIES.includes(sp.strategy as Strategy)
      ? (sp.strategy as Strategy)
      : (STRATEGIES.find((s) => (counts[s] ?? 0) > 0) ?? "flip");

  const stages = getStrategyTemplate(strategy).map((st) => ({
    key: st.key,
    name: st.name,
  }));
  const firstStageKey = stages[0]?.key ?? null;

  // Cards for the selected strategy. A deal with no currentStageName
  // sits in the first column (lifecycle not started yet).
  const cards = rows
    .filter((r) => r.asset?.strategy === strategy)
    .map((r) => {
      const econ = economicsFromBag(
        strategy,
        (r.asset?.economicsJson as Record<string, unknown> | null) ?? null,
      );
      const headline = headlineMetric(econ);
      return {
        assetId: r.asset!.id,
        transactionId: r.id,
        address: r.propertyAddress ?? r.contact.fullName,
        contactName: r.contact.fullName,
        assignee: r.assignedUser?.name ?? null,
        stageKey: r.asset?.currentStageName ?? firstStageKey,
        metricLabel: headline.label,
        metricValue: money(headline.value),
        closingDate:
          r.closingDate?.toLocaleDateString("en-US", { month: "short", day: "numeric" }) ?? null,
      };
    });

  return (
    <main className="mx-auto max-w-[1400px]">
      <header className="mb-4">
        <div className="reos-label">Investments</div>
        <h1 className="mt-1 font-display text-display-lg font-semibold">Board</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your investment deals across their lifecycle. Drag a card to move
          it to the next stage — that stage&rsquo;s tasks are created on the
          deal. Retail deals don&rsquo;t appear here.
        </p>
      </header>

      {/* Strategy tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {STRATEGIES.map((s) => {
          const n = counts[s] ?? 0;
          const active = s === strategy;
          const hasLifecycle = STRATEGY_TEMPLATES[s].length > 0;
          return (
            <Link
              key={s}
              href={`/board?strategy=${s}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text"
              } ${!hasLifecycle ? "opacity-50" : ""}`}
            >
              {LABEL[s]}
              <span className="tabular-nums opacity-70">{n}</span>
            </Link>
          );
        })}
      </div>

      <BoardClient strategy={strategy} stages={stages} cards={cards} />
    </main>
  );
}
