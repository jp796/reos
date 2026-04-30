/**
 * Production dashboard — YTD performance
 *
 * Shows closings, pending, volume, GCI, net commission, avg days to
 * close, monthly rollup, and per-source breakdown. All queries are
 * scoped to status='closed' transactions with closingDate inside the
 * requested year (default: current year).
 *
 * Numbers gracefully degrade: if no TransactionFinancials row exists,
 * dollar columns show "—" rather than $0. Once you populate
 * salePrice / grossCommission / netCommission on each closed txn,
 * the aggregates start reflecting real dollars.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { ExcludeRowButton } from "./ExcludeRowButton";

export const dynamic = "force-dynamic";

interface SearchParams {
  year?: string;
}

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
function monthLabel(mo: number) {
  return new Date(2000, mo - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  });
}

export default async function ProductionPage({
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
  const now = new Date();

  const [closedYTD, pendingActive, months, bySource, allTimeCounts] =
    await Promise.all([
      prisma.transaction.findMany({
        where: {
          status: "closed",
          excludeFromProduction: false,
          closingDate: { gte: yearStart, lt: yearEnd },
        },
        include: {
          contact: true,
          financials: true,
          attributions: { include: { sourceChannel: true } },
        },
        orderBy: { closingDate: "desc" },
      }),
      prisma.transaction.count({
        where: {
          status: { in: ["active", "pending"] },
        },
      }),
      prisma.$queryRaw<
        Array<{
          month: number;
          closings: bigint;
          volume: number | null;
          gci: number | null;
          net: number | null;
        }>
      >`
        SELECT
          EXTRACT(MONTH FROM t.closing_date)::int AS month,
          COUNT(*)::bigint AS closings,
          SUM(f.sale_price)::numeric AS volume,
          SUM(f.gross_commission)::numeric AS gci,
          SUM(f.net_commission)::numeric AS net
        FROM transactions t
        LEFT JOIN transaction_financials f ON f.transaction_id = t.id
        WHERE t.status='closed'
          AND t.exclude_from_production = false
          AND t.closing_date >= ${yearStart}
          AND t.closing_date <  ${yearEnd}
        GROUP BY EXTRACT(MONTH FROM t.closing_date)
        ORDER BY month
      `,
      prisma.$queryRaw<
        Array<{
          source_name: string | null;
          closings: bigint;
          volume: number | null;
          gci: number | null;
        }>
      >`
        SELECT
          COALESCE(c.source_name, '(unknown)') AS source_name,
          COUNT(*)::bigint AS closings,
          SUM(f.sale_price)::numeric AS volume,
          SUM(f.gross_commission)::numeric AS gci
        FROM transactions t
        JOIN contacts c ON c.id = t.contact_id
        LEFT JOIN transaction_financials f ON f.transaction_id = t.id
        WHERE t.status='closed'
          AND t.exclude_from_production = false
          AND t.closing_date >= ${yearStart}
          AND t.closing_date <  ${yearEnd}
        GROUP BY c.source_name
        ORDER BY closings DESC
      `,
      prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT status, COUNT(*)::bigint AS count FROM transactions GROUP BY status
      `,
    ]);

  /* ------------------------------------------------------------------
   * PIPELINE FUNNEL — leads → active → closed by source, plus
   * conversion% and avg days from contract to close. Used to drive
   * the "where do my best deals come from" question.
   * ------------------------------------------------------------------ */
  const pipeline = await prisma.$queryRaw<
    Array<{
      source_name: string | null;
      leads: bigint;
      active: bigint;
      closed_ytd: bigint;
      avg_days_to_close: number | null;
    }>
  >`
    WITH leads AS (
      SELECT COALESCE(source_name, '(unknown)') AS source_name,
             COUNT(*)::bigint AS leads
      FROM contacts
      GROUP BY source_name
    ),
    active AS (
      SELECT COALESCE(c.source_name, '(unknown)') AS source_name,
             COUNT(*)::bigint AS active
      FROM transactions t
      JOIN contacts c ON c.id = t.contact_id
      WHERE t.status IN ('listing','active','pending')
      GROUP BY c.source_name
    ),
    closed AS (
      SELECT COALESCE(c.source_name, '(unknown)') AS source_name,
             COUNT(*)::bigint AS closed_ytd,
             AVG(EXTRACT(EPOCH FROM (t.closing_date - t.contract_date)) / 86400)::float AS avg_days_to_close
      FROM transactions t
      JOIN contacts c ON c.id = t.contact_id
      WHERE t.status = 'closed'
        AND t.exclude_from_production = false
        AND t.closing_date IS NOT NULL
        AND t.contract_date IS NOT NULL
        AND t.closing_date >= ${yearStart}
        AND t.closing_date <  ${yearEnd}
      GROUP BY c.source_name
    )
    SELECT l.source_name,
           l.leads,
           COALESCE(a.active, 0)::bigint AS active,
           COALESCE(cl.closed_ytd, 0)::bigint AS closed_ytd,
           cl.avg_days_to_close
    FROM leads l
    LEFT JOIN active a ON a.source_name = l.source_name
    LEFT JOIN closed cl ON cl.source_name = l.source_name
    ORDER BY l.leads DESC
    LIMIT 25
  `;

  const totalClosings = closedYTD.length;
  const totalVolume = closedYTD.reduce(
    (s, t) => s + (t.financials?.salePrice ?? 0),
    0,
  );
  const totalGCI = closedYTD.reduce(
    (s, t) => s + (t.financials?.grossCommission ?? 0),
    0,
  );
  const totalNet = closedYTD.reduce(
    (s, t) => s + (t.financials?.netCommission ?? 0),
    0,
  );
  const avgSalePrice =
    closedYTD.filter((t) => t.financials?.salePrice).length > 0
      ? totalVolume /
        closedYTD.filter((t) => t.financials?.salePrice).length
      : null;
  const avgDaysToClose = (() => {
    const samples = closedYTD
      .filter((t) => t.contractDate && t.closingDate)
      .map((t) => {
        const d =
          (t.closingDate!.getTime() - t.contractDate!.getTime()) /
          (1000 * 60 * 60 * 24);
        return Math.round(d);
      });
    if (samples.length === 0) return null;
    return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  })();
  const missingFinancials = closedYTD.filter((t) => !t.financials).length;

  const allTimeClosed = Number(
    allTimeCounts.find((r) => r.status === "closed")?.count ?? 0,
  );

  // Pad months with zeroes so the table shows Jan → current month even
  // when some months have no closings.
  const currentMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const monthsMap = new Map(months.map((m) => [m.month, m]));
  const monthRows = Array.from({ length: currentMonth }, (_, i) => {
    const mo = i + 1;
    const row = monthsMap.get(mo);
    return {
      month: mo,
      closings: Number(row?.closings ?? 0),
      volume: row?.volume ? Number(row.volume) : null,
      gci: row?.gci ? Number(row.gci) : null,
      net: row?.net ? Number(row.net) : null,
    };
  });

  return (
    <main className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="reos-label">Production</div>
          <h1 className="mt-1 font-display text-display-lg font-semibold tabular-nums">
            {year}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            YTD closings, volume, GCI, net ·{" "}
            <span className="tabular-nums">{allTimeClosed}</span> closed all-time
            · <span className="tabular-nums">{pendingActive}</span> open
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link
            href={`/production?year=${year - 1}`}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-text-muted hover:border-border-strong hover:text-text"
          >
            ← {year - 1}
          </Link>
          <Link
            href={`/production?year=${year + 1}`}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-text-muted hover:border-border-strong hover:text-text"
          >
            {year + 1} →
          </Link>
        </div>
      </header>

      {/* Top-level tiles */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Closings YTD" value={totalClosings.toLocaleString()} />
        <Stat
          label="Volume"
          value={totalVolume > 0 ? fmtMoney(totalVolume) : "—"}
        />
        <Stat label="GCI" value={totalGCI > 0 ? fmtMoney(totalGCI) : "—"} />
        <Stat
          label="Net commission"
          value={totalNet > 0 ? fmtMoney(totalNet) : "—"}
        />
        <Stat label="Avg sale price" value={fmtMoney(avgSalePrice)} />
        <Stat
          label="Avg days to close"
          value={avgDaysToClose === null ? "—" : `${avgDaysToClose}d`}
        />
        <Stat label="Pending / active" value={pendingActive.toString()} />
        <Stat
          label="Missing financials"
          value={missingFinancials.toString()}
          tone={missingFinancials > 0 ? "amber" : "neutral"}
        />
      </section>

      {missingFinancials > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          {missingFinancials} closed transaction{missingFinancials === 1 ? "" : "s"} in {year} don&apos;t
          have sale price / commission captured yet. Add them per-transaction to
          populate volume / GCI / net.
        </p>
      )}

      {/* Monthly breakdown */}
      <section className="mt-8">
        <h2 className="mb-2 text-lg font-medium">Monthly</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 text-right font-medium">Closings</th>
                <th className="px-4 py-2 text-right font-medium">Volume</th>
                <th className="px-4 py-2 text-right font-medium">GCI</th>
                <th className="px-4 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((r) => (
                <tr key={r.month} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2 font-medium">{monthLabel(r.month)}</td>
                  <td className="px-4 py-2 text-right">
                    {r.closings || "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-text">
                    {fmtMoney(r.volume)}
                  </td>
                  <td className="px-4 py-2 text-right text-text">
                    {fmtMoney(r.gci)}
                  </td>
                  <td className="px-4 py-2 text-right text-text">
                    {fmtMoney(r.net)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-strong bg-surface-2 font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right">{totalClosings}</td>
                <td className="px-4 py-2 text-right">
                  {totalVolume > 0 ? fmtMoney(totalVolume) : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {totalGCI > 0 ? fmtMoney(totalGCI) : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {totalNet > 0 ? fmtMoney(totalNet) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* By source */}
      {bySource.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">By source</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 text-right font-medium">Closings</th>
                  <th className="px-4 py-2 text-right font-medium">Volume</th>
                  <th className="px-4 py-2 text-right font-medium">GCI</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((r) => (
                  <tr
                    key={r.source_name ?? "unknown"}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-2">{r.source_name}</td>
                    <td className="px-4 py-2 text-right">
                      {Number(r.closings)}
                    </td>
                    <td className="px-4 py-2 text-right text-text">
                      {r.volume ? fmtMoney(Number(r.volume)) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-text">
                      {r.gci ? fmtMoney(Number(r.gci)) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pipeline funnel — leads → active → closed by source */}
      {pipeline.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">Pipeline funnel</h2>
          <p className="mb-3 text-xs text-text-muted">
            How each source converts: leads in REOS → currently active deals →
            closed YTD. Conversion = closed YTD / leads.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-left">
                <tr>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                    Source
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-text-muted">
                    Leads
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-text-muted">
                    Active
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-text-muted">
                    Closed YTD
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-text-muted">
                    Conv %
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-text-muted">
                    Avg days
                  </th>
                </tr>
              </thead>
              <tbody>
                {pipeline.map((row) => {
                  const leads = Number(row.leads);
                  const active = Number(row.active);
                  const closed = Number(row.closed_ytd);
                  const conv = leads > 0 ? (closed / leads) * 100 : 0;
                  return (
                    <tr
                      key={row.source_name ?? "(unknown)"}
                      className="border-t border-border"
                    >
                      <td className="px-4 py-2 font-medium">
                        {row.source_name ?? "(unknown)"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                        {leads.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                        {active.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-text">
                        {closed.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                        {leads > 0 ? `${conv.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                        {row.avg_days_to_close
                          ? `${Math.round(row.avg_days_to_close)}d`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent closings (list) */}
      <section className="mt-8">
        <h2 className="mb-2 text-lg font-medium">Closings in {year}</h2>
        {closedYTD.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-strong p-8 text-center text-sm text-text-muted">
            No closings recorded in {year}. Apply the pending Settlement
            Statement updates on{" "}
            <Link href="/transactions" className="underline">
              /transactions
            </Link>{" "}
            to populate this list.
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {closedYTD.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/transactions/${t.id}`}
                    className="font-medium hover:underline"
                  >
                    {t.contact.fullName}
                  </Link>
                  <div className="text-xs text-text-muted">
                    {t.propertyAddress ?? "No address"} · {t.transactionType}
                    {t.contact.sourceName && ` · ${t.contact.sourceName}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-text">{fmtDate(t.closingDate)}</div>
                  <div className="text-xs text-text-muted">
                    {t.financials?.salePrice
                      ? fmtMoney(t.financials.salePrice)
                      : "no price"}
                  </div>
                </div>
                <ExcludeRowButton transactionId={t.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "amber";
}) {
  const t =
    tone === "amber"
      ? "border-accent-200 bg-accent-100/40 dark:bg-accent-100/50 text-accent-500"
      : "border-border bg-surface text-text";
  return (
    <div className={`rounded-md border p-4 shadow-sm ${t}`}>
      <div className="reos-label opacity-80">{label}</div>
      <div className="mt-2 font-display text-display-md font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}
