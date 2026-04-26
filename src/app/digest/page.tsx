/**
 * Weekly digest — Monday-morning snapshot.
 *
 * Five blocks, server-rendered:
 *   1. Closed last 7 days  (with sale price + GCI)
 *   2. Closing next 7 days (countdown)
 *   3. Deadlines next 7 days (across active deals)
 *   4. Silent deals (active, no comm in 14+ days)
 *   5. Top sources YTD by GCI
 *
 * Pure read-only. No mutations. Designed to be the "what changed and
 * what's coming" view a TC opens once a week.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function fmtRel(d: Date) {
  const days = Math.round((d.getTime() - Date.now()) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days}d`;
  return `${-days}d ago`;
}

export default async function DigestPage() {
  const actor = await requireSession();
  if (actor instanceof Response) return null;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const weekFromNow = new Date(now.getTime() + 7 * DAY_MS);
  const fortnightAgo = new Date(now.getTime() - 14 * DAY_MS);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // 1. Closed last 7d
  const closedLast7 = await prisma.transaction.findMany({
    where: {
      accountId: actor.accountId,
      status: "closed",
      closingDate: { gte: weekAgo, lte: now },
    },
    include: { contact: true, financials: true },
    orderBy: { closingDate: "desc" },
  });

  // 2. Closing next 7d (still active/pending)
  const closingNext7 = await prisma.transaction.findMany({
    where: {
      accountId: actor.accountId,
      status: { in: ["active", "pending"] },
      closingDate: { gt: now, lte: weekFromNow },
    },
    include: { contact: true, financials: true },
    orderBy: { closingDate: "asc" },
  });

  // 3. Deadlines next 7d across active deals (milestones)
  const upcomingMilestones = await prisma.milestone.findMany({
    where: {
      transaction: {
        accountId: actor.accountId,
        status: { in: ["active", "pending"] },
      },
      completedAt: null,
      dueAt: { gt: now, lte: weekFromNow },
    },
    include: { transaction: { include: { contact: true } } },
    orderBy: { dueAt: "asc" },
    take: 25,
  });

  // 4. Silent deals — active, last comm event >14d ago (or none).
  const silentCandidates = await prisma.transaction.findMany({
    where: { accountId: actor.accountId, status: "active" },
    include: {
      contact: true,
      communicationEvents: {
        orderBy: { happenedAt: "desc" },
        take: 1,
      },
    },
  });
  const silent = silentCandidates
    .map((t) => {
      const last = t.communicationEvents[0]?.happenedAt ?? t.createdAt;
      const days = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
      return { ...t, lastTouchDays: days };
    })
    .filter((t) => t.lastTouchDays >= 14)
    .sort((a, b) => b.lastTouchDays - a.lastTouchDays)
    .slice(0, 10);

  // 5. Top sources YTD by GCI
  const sourcesAgg = await prisma.$queryRaw<
    Array<{ source_name: string; gci: number; closings: bigint }>
  >`
    SELECT
      COALESCE(c.source_name, '—') AS source_name,
      SUM(COALESCE(f.gross_commission, 0)) AS gci,
      COUNT(*)::bigint AS closings
    FROM transactions t
    JOIN contacts c ON c.id = t.contact_id
    LEFT JOIN transaction_financials f ON f.transaction_id = t.id
    WHERE t.account_id = ${actor.accountId}
      AND t.status = 'closed'
      AND t.closing_date >= ${yearStart}
    GROUP BY c.source_name
    ORDER BY gci DESC NULLS LAST
    LIMIT 5
  `;

  const totals = {
    closedCount: closedLast7.length,
    closedGci: closedLast7.reduce(
      (s, t) => s + (t.financials?.grossCommission ?? 0),
      0,
    ),
    closingNextCount: closingNext7.length,
    closingNextVolume: closingNext7.reduce(
      (s, t) => s + (t.financials?.salePrice ?? 0),
      0,
    ),
  };

  // Pretty week-of label
  const weekStart = new Date(now);
  const dow = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dow);
  const weekOf = weekStart.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <h1 className="font-display text-h1 font-semibold">Weekly digest</h1>
        <p className="mt-1 text-sm text-text-muted">
          Snapshot for the week of {weekOf}. {totals.closedCount} closed last 7
          days · {totals.closingNextCount} closing next 7 · {silent.length} silent
          deal{silent.length === 1 ? "" : "s"}.
        </p>
      </header>

      {/* KPI strip */}
      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Closings · last 7d" value={String(totals.closedCount)} />
        <Kpi
          label="GCI · last 7d"
          value={fmtMoney(totals.closedGci)}
          emphasis
        />
        <Kpi
          label="Closing · next 7d"
          value={String(totals.closingNextCount)}
        />
        <Kpi
          label="Volume · next 7d"
          value={fmtMoney(totals.closingNextVolume)}
        />
      </section>

      <Block title={`Closed · last 7 days · ${closedLast7.length}`}>
        {closedLast7.length === 0 ? (
          <Empty>No closings landed in the last week.</Empty>
        ) : (
          <Rows>
            {closedLast7.map((t) => (
              <Row
                key={t.id}
                href={`/transactions/${t.id}`}
                left={t.contact.fullName}
                middle={t.propertyAddress ?? "—"}
                right={fmtMoney(t.financials?.grossCommission)}
                rightLabel="GCI"
                date={t.closingDate ? fmtDate(t.closingDate) : null}
              />
            ))}
          </Rows>
        )}
      </Block>

      <Block title={`Closing · next 7 days · ${closingNext7.length}`}>
        {closingNext7.length === 0 ? (
          <Empty>Nothing closing this week.</Empty>
        ) : (
          <Rows>
            {closingNext7.map((t) => (
              <Row
                key={t.id}
                href={`/transactions/${t.id}`}
                left={t.contact.fullName}
                middle={t.propertyAddress ?? "—"}
                right={fmtMoney(t.financials?.salePrice)}
                rightLabel="Price"
                date={t.closingDate ? fmtRel(t.closingDate) : null}
              />
            ))}
          </Rows>
        )}
      </Block>

      <Block title={`Deadlines · next 7 days · ${upcomingMilestones.length}`}>
        {upcomingMilestones.length === 0 ? (
          <Empty>No deadlines this week.</Empty>
        ) : (
          <Rows>
            {upcomingMilestones.map((m) => (
              <Row
                key={m.id}
                href={`/transactions/${m.transaction.id}`}
                left={m.label}
                middle={m.transaction.propertyAddress ?? m.transaction.contact.fullName}
                right={m.dueAt ? fmtRel(m.dueAt) : "—"}
                rightLabel=""
                date={m.dueAt ? fmtDate(m.dueAt) : null}
              />
            ))}
          </Rows>
        )}
      </Block>

      <Block title={`Silent deals · ${silent.length}`}>
        {silent.length === 0 ? (
          <Empty>No silent deals — every active file has had recent activity.</Empty>
        ) : (
          <Rows>
            {silent.map((t) => (
              <Row
                key={t.id}
                href={`/transactions/${t.id}`}
                left={t.contact.fullName}
                middle={t.propertyAddress ?? "—"}
                right={`${t.lastTouchDays}d`}
                rightLabel="quiet"
                date={null}
                tone="warn"
              />
            ))}
          </Rows>
        )}
      </Block>

      <Block title={`Top sources · YTD by GCI`}>
        {sourcesAgg.length === 0 ? (
          <Empty>No closed YTD volume yet.</Empty>
        ) : (
          <Rows>
            {sourcesAgg.map((s) => (
              <div
                key={s.source_name}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
              >
                <span className="font-medium">{s.source_name}</span>
                <span className="text-xs text-text-muted">
                  {Number(s.closings)} closing{Number(s.closings) === 1 ? "" : "s"}
                </span>
                <span className="ml-auto font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {fmtMoney(Number(s.gci))}
                </span>
              </div>
            ))}
          </Rows>
        )}
      </Block>
    </div>
  );
}

function Kpi({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="reos-label">{label}</div>
      <div
        className={
          "mt-1 font-display tabular-nums " +
          (emphasis
            ? "text-display-md font-semibold text-emerald-700 dark:text-emerald-300"
            : "text-display-sm font-semibold")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-2/40 px-3 py-4 text-center text-sm text-text-muted">
      {children}
    </div>
  );
}

function Row({
  href,
  left,
  middle,
  right,
  rightLabel,
  date,
  tone,
}: {
  href: string;
  left: string;
  middle: string;
  right: string;
  rightLabel: string;
  date: string | null;
  tone?: "warn";
}) {
  return (
    <Link
      href={href}
      className={
        "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:border-brand-500 " +
        (tone === "warn"
          ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30"
          : "border-border bg-surface")
      }
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text">{left}</span>
        <span className="block truncate text-xs text-text-muted">{middle}</span>
      </span>
      {date && (
        <span className="hidden shrink-0 text-xs text-text-muted sm:inline">
          {date}
        </span>
      )}
      <span className="shrink-0 text-right">
        <span className="block font-semibold tabular-nums">{right}</span>
        {rightLabel && (
          <span className="block text-[10px] uppercase tracking-wide text-text-muted">
            {rightLabel}
          </span>
        )}
      </span>
    </Link>
  );
}
