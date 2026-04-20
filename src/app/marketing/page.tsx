/**
 * Marketing spend entry
 *
 * Add / delete spend entries per source channel, with a quick "new source"
 * creator for channels you haven't tagged yet. Feeds the /sources CAC/ROI.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { MarketingSpendPanel } from "./MarketingSpendPanel";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const [sources, spendsRaw] = await Promise.all([
    prisma.sourceChannel.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true },
    }),
    prisma.marketingSpend.findMany({
      orderBy: { spendDate: "desc" },
      include: { sourceChannel: { select: { name: true, category: true } } },
      take: 200,
    }),
  ]);

  const spends = spendsRaw.map((s) => ({
    id: s.id,
    spendDate: s.spendDate.toISOString(),
    amount: s.amount,
    notes: s.notes,
    sourceChannelId: s.sourceChannelId,
    sourceName: s.sourceChannel.name,
    sourceCategory: s.sourceChannel.category,
  }));

  const year = new Date().getFullYear();
  const ytdTotal = spends
    .filter((s) => new Date(s.spendDate).getFullYear() === year)
    .reduce((sum, s) => sum + s.amount, 0);

  return (
    <main className="mx-auto max-w-6xl">
      <header className="mb-8">
        <div className="reos-label">Marketing · {year}</div>
        <h1 className="mt-1 font-display text-display-lg font-semibold">
          Spend by source
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          YTD{" "}
          <span className="font-medium tabular-nums text-text">
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            }).format(ytdTotal)}
          </span>{" "}
          across{" "}
          <span className="tabular-nums">
            {spends.filter((s) => new Date(s.spendDate).getFullYear() === year)
              .length}
          </span>{" "}
          entries.
        </p>
      </header>

      <MarketingSpendPanel initialSpends={spends} initialSources={sources} />
    </main>
  );
}
