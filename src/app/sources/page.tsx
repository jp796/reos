/**
 * Source performance dashboard
 *
 * Per-source: leads (contacts), closings YTD, volume, GCI, net,
 * marketing spend YTD, CAC, ROI. The per-source rows use whatever
 * TransactionFinancials + MarketingSpend data is populated; missing
 * values show "—" and don't poison aggregates.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

interface SearchParams {
  year?: string;
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const year = Math.max(
    2000,
    Math.min(2100, parseInt(sp.year ?? "", 10) || new Date().getFullYear()),
  );
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const rows = await prisma.$queryRaw<
    Array<{
      source_name: string | null;
      leads: bigint;
      closings: bigint;
      volume: number | null;
      gci: number | null;
      net: number | null;
      spend: number | null;
    }>
  >`
    WITH c AS (
      SELECT COALESCE(source_name, '(unknown)') AS source_name,
             COUNT(*)::bigint AS leads
      FROM contacts
      GROUP BY source_name
    ),
    closings AS (
      SELECT COALESCE(c.source_name, '(unknown)') AS source_name,
             COUNT(*)::bigint AS closings,
             SUM(f.sale_price)::numeric AS volume,
             SUM(f.gross_commission)::numeric AS gci,
             SUM(f.net_commission)::numeric AS net
      FROM transactions t
      JOIN contacts c ON c.id = t.contact_id
      LEFT JOIN transaction_financials f ON f.transaction_id = t.id
      WHERE t.status = 'closed'
        AND t.closing_date >= ${yearStart}
        AND t.closing_date <  ${yearEnd}
      GROUP BY c.source_name
    ),
    spend AS (
      SELECT sc.name AS source_name,
             SUM(ms.amount)::numeric AS spend
      FROM marketing_spends ms
      JOIN source_channels sc ON sc.id = ms.source_channel_id
      WHERE ms.spend_date >= ${yearStart}
        AND ms.spend_date <  ${yearEnd}
      GROUP BY sc.name
    )
    SELECT c.source_name,
           c.leads,
           COALESCE(cl.closings, 0)::bigint AS closings,
           cl.volume,
           cl.gci,
           cl.net,
           sp.spend
    FROM c
    LEFT JOIN closings cl ON cl.source_name = c.source_name
    LEFT JOIN spend sp ON sp.source_name = c.source_name
    ORDER BY COALESCE(cl.closings, 0) DESC, c.leads DESC
    LIMIT 50
  `;

  const totalLeads = rows.reduce((s, r) => s + Number(r.leads), 0);
  const totalClosings = rows.reduce((s, r) => s + Number(r.closings), 0);
  const totalVolume = rows.reduce((s, r) => s + Number(r.volume ?? 0), 0);
  const totalGCI = rows.reduce((s, r) => s + Number(r.gci ?? 0), 0);
  const totalNet = rows.reduce((s, r) => s + Number(r.net ?? 0), 0);
  const totalSpend = rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
  const overallCAC =
    totalClosings > 0 && totalSpend > 0 ? totalSpend / totalClosings : null;
  const overallROI =
    totalSpend > 0 ? (totalNet - totalSpend) / totalSpend : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
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
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Source performance · {year}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Leads → closings → dollars → CAC / ROI, per source channel
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link
            href={`/sources?year=${year - 1}`}
            className="rounded border border-neutral-200 px-2 py-1 hover:border-neutral-400"
          >
            ← {year - 1}
          </Link>
          <Link
            href={`/sources?year=${year + 1}`}
            className="rounded border border-neutral-200 px-2 py-1 hover:border-neutral-400"
          >
            {year + 1} →
          </Link>
        </div>
      </header>

      {/* Aggregate tiles */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Leads" value={totalLeads.toLocaleString()} />
        <Stat label="Closings YTD" value={totalClosings.toString()} />
        <Stat label="GCI" value={totalGCI > 0 ? fmtMoney(totalGCI) : "—"} />
        <Stat label="Net" value={totalNet > 0 ? fmtMoney(totalNet) : "—"} />
        <Stat
          label="Marketing spend"
          value={totalSpend > 0 ? fmtMoney(totalSpend) : "—"}
        />
        <Stat label="CAC (overall)" value={fmtMoney(overallCAC)} />
        <Stat label="ROI (overall)" value={fmtPct(overallROI)} />
        <Stat
          label="Conversion"
          value={
            totalLeads > 0 ? fmtPct(totalClosings / totalLeads) : "—"
          }
        />
      </section>

      {/* Per-source table */}
      <section className="mt-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 text-right font-medium">Leads</th>
              <th className="px-4 py-2 text-right font-medium">Closings</th>
              <th className="px-4 py-2 text-right font-medium">Conv.</th>
              <th className="px-4 py-2 text-right font-medium">Volume</th>
              <th className="px-4 py-2 text-right font-medium">GCI</th>
              <th className="px-4 py-2 text-right font-medium">Net</th>
              <th className="px-4 py-2 text-right font-medium">Spend</th>
              <th className="px-4 py-2 text-right font-medium">CAC</th>
              <th className="px-4 py-2 text-right font-medium">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const leads = Number(r.leads);
              const closings = Number(r.closings);
              const volume = r.volume ? Number(r.volume) : null;
              const gci = r.gci ? Number(r.gci) : null;
              const net = r.net ? Number(r.net) : null;
              const spend = r.spend ? Number(r.spend) : null;
              const conv = leads > 0 ? closings / leads : null;
              const cac = closings > 0 && spend ? spend / closings : null;
              const roi =
                spend !== null && spend > 0 && net !== null
                  ? (net - spend) / spend
                  : null;
              return (
                <tr
                  key={r.source_name ?? "unknown"}
                  className="border-b border-neutral-100 last:border-0"
                >
                  <td className="px-4 py-2 font-medium">{r.source_name}</td>
                  <td className="px-4 py-2 text-right">{leads.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    {closings || "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {fmtPct(conv)}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {fmtMoney(volume)}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {fmtMoney(gci)}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {fmtMoney(net)}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {fmtMoney(spend)}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {fmtMoney(cac)}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {fmtPct(roi)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="mt-4 text-xs text-neutral-500">
        CAC and ROI only populate for sources with marketing spend entered.
        Add entries to the MarketingSpend table to light up those columns.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
    </div>
  );
}
