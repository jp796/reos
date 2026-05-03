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
        AND t.exclude_from_production = false
        AND t.is_demo = false
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
    <main className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="reos-label">Source performance · {year}</div>
          <h1 className="mt-1 font-display text-display-lg font-semibold">
            Where deals come from
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Leads → closings → dollars → CAC / ROI, per channel
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link
            href={`/sources?year=${year - 1}`}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-text-muted hover:border-border-strong hover:text-text"
          >
            ← {year - 1}
          </Link>
          <Link
            href={`/sources?year=${year + 1}`}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-text-muted hover:border-border-strong hover:text-text"
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
      <section className="mt-8 overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2 text-left">
            <tr className="text-text-muted">
              <th className="px-4 py-2.5 font-medium">Source</th>
              <th className="px-4 py-2.5 text-right font-medium">Leads</th>
              <th className="px-4 py-2.5 text-right font-medium">Closings</th>
              <th className="px-4 py-2.5 text-right font-medium">Conv.</th>
              <th className="px-4 py-2.5 text-right font-medium">Volume</th>
              <th className="px-4 py-2.5 text-right font-medium">GCI</th>
              <th className="px-4 py-2.5 text-right font-medium">Net</th>
              <th className="px-4 py-2.5 text-right font-medium">Spend</th>
              <th className="px-4 py-2.5 text-right font-medium">CAC</th>
              <th className="px-4 py-2.5 text-right font-medium">ROI</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
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
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2 font-medium text-text">
                    {r.source_name}
                  </td>
                  <td className="px-4 py-2 text-right text-text">
                    {leads.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right text-text">
                    {closings || "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-text-muted">
                    {fmtPct(conv)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-muted">
                    {fmtMoney(volume)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-muted">
                    {fmtMoney(gci)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-muted">
                    {fmtMoney(net)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-muted">
                    {fmtMoney(spend)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-muted">
                    {fmtMoney(cac)}
                  </td>
                  <td className="px-4 py-2 text-right text-text-muted">
                    {fmtPct(roi)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="mt-4 text-xs text-text-muted">
        CAC and ROI only populate for sources with marketing spend entered.{" "}
        <Link href="/marketing" className="text-brand-700 underline">
          Add a spend entry →
        </Link>
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
      <div className="reos-label opacity-80">{label}</div>
      <div className="mt-2 font-display text-display-md font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}
