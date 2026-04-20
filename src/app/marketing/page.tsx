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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-6 flex items-center gap-4 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-900">
          Home
        </Link>
        <span className="text-neutral-300">·</span>
        <Link href="/today" className="hover:text-neutral-900">
          Today
        </Link>
        <span className="text-neutral-300">·</span>
        <Link href="/production" className="hover:text-neutral-900">
          Production
        </Link>
        <span className="text-neutral-300">·</span>
        <Link href="/sources" className="hover:text-neutral-900">
          Sources
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          Marketing spend
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Track dollars per source channel. YTD {year}:{" "}
          <span className="font-medium text-neutral-900">
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            }).format(ytdTotal)}
          </span>{" "}
          across {spends.filter((s) => new Date(s.spendDate).getFullYear() === year).length}{" "}
          entries.
        </p>
      </header>

      <MarketingSpendPanel initialSpends={spends} initialSources={sources} />
    </main>
  );
}
