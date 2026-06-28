/**
 * Insights — "your whole book at a glance".
 *
 * A Monday.com-style rollup dashboard: a top row of metric cards over a
 * responsive grid of widgets (deals-by-stage, GCI-by-month, upcoming
 * deadlines, overdue tasks). Read-only aggregations only.
 *
 * TENANT ISOLATION (non-negotiable, per CLAUDE.md): every query below is
 * scoped by `accountId: actor.accountId` AND ANDs in `dealVisibilityWhere
 * (actor)`. Transaction queries apply both directly; milestone/task
 * queries apply both through the nested `transaction` relation filter so
 * a restricted deal can't leak its deadlines or tasks into the rollup.
 * No `findFirst` of an account anywhere.
 */

import {
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Layers,
} from "lucide-react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { dealVisibilityWhere } from "@/lib/deal-visibility";
import {
  DeadlineList,
  GciBar,
  MetricCard,
  StageBar,
  TaskList,
  type DeadlineDatum,
  type MonthDatum,
  type StageDatum,
  type TaskDatum,
} from "./InsightWidgets";

export const dynamic = "force-dynamic";

// Stage rows render in this fixed order regardless of which statuses
// currently have rows in the DB, so the funnel reads top-to-bottom.
const STAGE_ORDER: ReadonlyArray<{ key: string; label: string }> = [
  { key: "listing", label: "Listing" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "closed", label: "Closed" },
  { key: "dead", label: "Dead" },
];

// Statuses that count as "open" (not closed, not dead) — used for the
// open-deals metric and the GCI pipeline sum.
const OPEN_STATUSES = ["listing", "active", "pending"] as const;

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatCurrency(n: number): string {
  return currencyFmt.format(Math.round(n));
}

/** "Mon DD" — e.g. "Jul 04". Matches the spec's date format. */
function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** First instant of the month `offset` months from `base` (local time). */
function startOfMonth(base: Date, offset: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + offset, 1, 0, 0, 0, 0);
}

export default async function InsightsPage() {
  const actor = await requireSession();
  if (actor instanceof Response) redirect("/login");

  // Shared tenant filter for transaction-level queries. dealVisibilityWhere
  // returns {} for owners/admins and an OR clause for everyone else, so it
  // ANDs cleanly alongside the accountId scope.
  const txnScope = {
    accountId: actor.accountId,
    ...dealVisibilityWhere(actor),
  };
  // Same scope expressed as a nested filter for milestone/task queries that
  // reach the account through their parent transaction.
  const txnRelationScope = {
    accountId: actor.accountId,
    ...dealVisibilityWhere(actor),
  };

  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  // Calendar-month window for "closings this month".
  const monthStart = startOfMonth(now, 0);
  const nextMonthStart = startOfMonth(now, 1);
  // 6-month GCI horizon: [monthStart, +6 months).
  const gciHorizonEnd = startOfMonth(now, 6);

  const [
    stageGroups,
    openFinancials,
    upcomingMilestones,
    closingsThisMonth,
    overdueTaskRows,
    overdueTaskCount,
  ] = await Promise.all([
    // (a) Deals by stage — count transactions grouped by status.
    prisma.transaction.groupBy({
      by: ["status"],
      where: txnScope,
      _count: { _all: true },
    }),

    // (b) GCI pipeline — gross commission on non-closed (open) deals, with
    // closingDate so we can bucket the next ~6 months. Pull only the two
    // fields we need from the financials relation.
    prisma.transaction.findMany({
      where: {
        ...txnScope,
        status: { in: [...OPEN_STATUSES] },
        financials: { is: { grossCommission: { not: null } } },
      },
      select: {
        closingDate: true,
        financials: { select: { grossCommission: true } },
      },
    }),

    // (c) Upcoming deadlines (14 days) — pending, uncompleted milestones
    // due between now and +14d, scoped through the parent transaction.
    prisma.milestone.findMany({
      where: {
        completedAt: null,
        dueAt: { gte: now, lte: in14Days },
        transaction: txnRelationScope,
      },
      select: {
        id: true,
        label: true,
        dueAt: true,
        transaction: { select: { id: true, propertyAddress: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 12,
    }),

    // (d) Closings this month — transactions whose closingDate falls in the
    // current calendar month.
    prisma.transaction.findMany({
      where: {
        ...txnScope,
        closingDate: { gte: monthStart, lt: nextMonthStart },
      },
      select: { id: true, propertyAddress: true, closingDate: true },
      orderBy: { closingDate: "asc" },
    }),

    // (e) Overdue tasks — past due, not completed, scoped through the
    // parent transaction. List (limit 10) …
    prisma.task.findMany({
      where: {
        completedAt: null,
        dueAt: { lt: now },
        transaction: txnRelationScope,
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        transaction: { select: { id: true, propertyAddress: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    // … and the full overdue count for the metric card.
    prisma.task.count({
      where: {
        completedAt: null,
        dueAt: { lt: now },
        transaction: txnRelationScope,
      },
    }),
  ]);

  // ---- Shape (a): deals by stage, in fixed funnel order ----
  const countByStatus = new Map<string, number>();
  for (const g of stageGroups) {
    countByStatus.set(g.status, g._count._all);
  }
  const stageData: StageDatum[] = STAGE_ORDER.map((s) => ({
    key: s.key,
    label: s.label,
    count: countByStatus.get(s.key) ?? 0,
  }));
  const openDealsCount = OPEN_STATUSES.reduce(
    (sum, status) => sum + (countByStatus.get(status) ?? 0),
    0,
  );

  // ---- Shape (b): GCI pipeline total + by-month buckets ----
  let pipelineGci = 0;
  // Seed six month buckets so empty months still render an axis row.
  const monthBuckets: MonthDatum[] = [];
  const bucketIndexByKey = new Map<string, number>();
  for (let i = 0; i < 6; i++) {
    const monthDate = startOfMonth(now, i);
    const key = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
    bucketIndexByKey.set(key, i);
    monthBuckets.push({
      label: monthDate.toLocaleDateString("en-US", { month: "short" }),
      amount: 0,
    });
  }
  for (const txn of openFinancials) {
    const gci = txn.financials?.grossCommission;
    if (gci == null) continue; // belt-and-suspenders; query already filters
    pipelineGci += gci;
    // Bucket by closingDate when it lands inside the 6-month horizon.
    const cd = txn.closingDate;
    if (cd && cd >= monthStart && cd < gciHorizonEnd) {
      const key = `${cd.getFullYear()}-${cd.getMonth()}`;
      const idx = bucketIndexByKey.get(key);
      if (idx != null) {
        monthBuckets[idx].amount += gci;
      }
    }
  }

  // ---- Shape (c): upcoming deadlines ----
  const deadlineData: DeadlineDatum[] = upcomingMilestones.map((m) => ({
    id: m.id,
    label: m.label,
    dealAddress: m.transaction.propertyAddress ?? "No address",
    transactionId: m.transaction.id,
    // dueAt is non-null here: the query filtered `dueAt` to a date range,
    // so Prisma never returns rows with a null dueAt.
    dateLabel: m.dueAt ? fmtMonthDay(m.dueAt) : "—",
  }));

  // ---- Shape (e): overdue tasks ----
  const taskData: TaskDatum[] = overdueTaskRows.map((t) => ({
    id: t.id,
    title: t.title,
    dealAddress: t.transaction.propertyAddress ?? "No address",
    transactionId: t.transaction.id,
    dateLabel: t.dueAt ? fmtMonthDay(t.dueAt) : "—",
  }));

  const deadlineCount = upcomingMilestones.length;

  return (
    <main className="mx-auto max-w-6xl">
      <header>
        <h1 className="font-display text-display-lg font-semibold">Insights</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your whole book at a glance.
        </p>
      </header>

      {/* Metric row */}
      <section className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Open deals"
          value={intFmt.format(openDealsCount)}
          icon={Layers}
        />
        <MetricCard
          label="Pipeline GCI"
          value={formatCurrency(pipelineGci)}
          icon={CircleDollarSign}
        />
        <MetricCard
          label="Deadlines next 14d"
          value={intFmt.format(deadlineCount)}
          icon={CalendarClock}
        />
        <MetricCard
          label="Overdue tasks"
          value={intFmt.format(overdueTaskCount)}
          icon={ClipboardList}
        />
      </section>

      {/* Widget grid */}
      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <StageBar data={stageData} />
        <GciBar data={monthBuckets} formatCurrency={formatCurrency} />
        <DeadlineList items={deadlineData} />
        <TaskList items={taskData} />
      </section>

      {/* Closings this month — count + list under the grid */}
      <section className="mt-8 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="reos-label">Closings this month</h2>
          <span className="text-[11px] text-text-subtle tabular-nums">
            {intFmt.format(closingsThisMonth.length)} scheduled
          </span>
        </div>
        {closingsThisMonth.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-muted">
            Nothing scheduled to close this month.
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {closingsThisMonth.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md bg-surface-2 p-3"
              >
                <span className="min-w-0 truncate text-sm text-text">
                  {t.propertyAddress ?? "No address"}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-subtle">
                  {t.closingDate ? fmtMonthDay(t.closingDate) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
