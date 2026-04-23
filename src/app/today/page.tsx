/**
 * Today dashboard — the "chief of staff" view.
 *
 * Shows the 5 things that matter right now, ranked by urgency:
 *   1. Overdue milestones across all active transactions
 *   2. Deadlines in the next 7 days
 *   3. Silent deals — active transactions with no recent communication
 *   4. Transactions closing in the next 30 days
 *   5. Pending review queue from the title-order scan
 *
 * Pure read-only dashboard, dynamic rendering, one-shot DB queries.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  RiskScoringService,
  riskHealth,
  riskHealthTone,
} from "@/services/core/RiskScoringService";
import { ReconcileSSButton } from "./ReconcileSSButton";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtRel(d: Date) {
  const ms = d.getTime() - Date.now();
  const days = Math.round(ms / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days}d`;
  return `${-days}d ago`;
}

export default async function TodayPage() {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * DAY_MS);
  const monthFromNow = new Date(now.getTime() + 30 * DAY_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [
    overdueMilestones,
    weekDeadlines,
    silentCandidates,
    closingSoon,
    pendingReviewCount,
    counts,
    allActive,
    overdueTasks,
    weekTasks,
  ] = await Promise.all([
    prisma.milestone.findMany({
      where: {
        status: "pending",
        completedAt: null,
        dueAt: { lte: now },
        transaction: { status: "active" },
      },
      include: {
        transaction: { include: { contact: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 25,
    }),
    prisma.milestone.findMany({
      where: {
        status: "pending",
        completedAt: null,
        dueAt: { gt: now, lte: weekFromNow },
        transaction: { status: "active" },
      },
      include: {
        transaction: { include: { contact: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 25,
    }),
    prisma.transaction.findMany({
      where: { status: "active" },
      include: {
        contact: true,
        communicationEvents: {
          orderBy: { happenedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.transaction.findMany({
      where: {
        status: "active",
        closingDate: { gte: now, lte: monthFromNow },
      },
      include: { contact: true },
      orderBy: { closingDate: "asc" },
      take: 15,
    }),
    prisma.pendingEmailMatch.count({
      where: { status: "pending" },
    }),
    prisma.$queryRaw<
      Array<{ active: bigint; closed: bigint; total_contacts: bigint }>
    >`
      SELECT
        (SELECT COUNT(*) FROM transactions WHERE status='active')::bigint AS active,
        (SELECT COUNT(*) FROM transactions WHERE status='closed')::bigint AS closed,
        (SELECT COUNT(*) FROM contacts)::bigint AS total_contacts
    `,
    prisma.transaction.findMany({
      where: { status: "active" },
      include: {
        contact: true,
        milestones: true,
        tasks: true,
        communicationEvents: { orderBy: { happenedAt: "desc" }, take: 10 },
      },
    }),
    // TC work queue — overdue tasks across every active deal
    prisma.task.findMany({
      where: {
        completedAt: null,
        dueAt: { lte: now },
        transaction: { status: "active" },
      },
      include: {
        transaction: {
          select: { id: true, propertyAddress: true, contact: { select: { fullName: true } } },
        },
      },
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
      take: 25,
    }),
    // Tasks due in the next 7 days
    prisma.task.findMany({
      where: {
        completedAt: null,
        dueAt: { gt: now, lte: weekFromNow },
        transaction: { status: "active" },
      },
      include: {
        transaction: {
          select: { id: true, propertyAddress: true, contact: { select: { fullName: true } } },
        },
      },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      take: 25,
    }),
  ]);

  // Score every active transaction once, keep the top 10 by risk score
  const risker = new RiskScoringService();
  const ranked = allActive
    .map((t) => ({
      txn: t,
      risk: risker.compute({ transaction: t }),
    }))
    .filter((x) => x.risk.score >= 15)
    .sort((a, b) => b.risk.score - a.risk.score)
    .slice(0, 10);

  // Silent deals: most recent comm > 7 days ago, or no comms at all
  const silentDeals = silentCandidates
    .map((t) => {
      const last = t.communicationEvents[0]?.happenedAt ?? t.createdAt;
      const daysSince = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
      return { txn: t, lastTouch: last, daysSince };
    })
    .filter((x) => x.daysSince >= 7)
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, 15);

  const activeCount = Number(counts[0]?.active ?? 0);
  const closedCount = Number(counts[0]?.closed ?? 0);
  const contactCount = Number(counts[0]?.total_contacts ?? 0);

  return (
    <main className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-display-lg font-semibold">Today</h1>
          <p className="mt-1 text-sm text-text-muted">
            What needs your attention right now ·{" "}
            <span className="tabular-nums">{activeCount}</span> active ·{" "}
            <span className="tabular-nums">{closedCount}</span> closed ·{" "}
            <span className="tabular-nums">
              {contactCount.toLocaleString()}
            </span>{" "}
            contacts
          </p>
        </div>
        <ReconcileSSButton />
      </header>

      {/* KPI strip */}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Overdue"
          value={overdueMilestones.length}
          tone={overdueMilestones.length > 0 ? "red" : "neutral"}
        />
        <Stat
          label="This week"
          value={weekDeadlines.length}
          tone={weekDeadlines.length > 0 ? "amber" : "neutral"}
        />
        <Stat
          label="Silent (7d+)"
          value={silentDeals.length}
          tone={silentDeals.length > 0 ? "amber" : "neutral"}
        />
        <Stat
          label="Pending review"
          value={pendingReviewCount}
          tone={pendingReviewCount > 0 ? "amber" : "neutral"}
          href="/transactions"
        />
      </section>

      {/* At risk */}
      <Section
        title="At risk"
        subtitle="Active transactions scored by the risk engine"
        count={ranked.length}
      >
        {ranked.length === 0 ? (
          <Empty>No active transaction is flagged by the risk engine.</Empty>
        ) : (
          <ul className="space-y-2">
            {ranked.map(({ txn, risk }) => {
              const h = riskHealth(risk.score);
              return (
                <li
                  key={txn.id}
                  className={`rounded-md border p-3 ${riskHealthTone(h)}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <Link
                        href={`/transactions/${txn.id}`}
                        className="font-medium hover:underline"
                      >
                        {txn.contact.fullName}
                      </Link>
                      <div className="text-xs opacity-80">
                        {txn.propertyAddress ?? "No address"} · {txn.transactionType}
                      </div>
                      <div className="mt-1 text-xs">
                        {risk.factors[0]?.description ?? "—"}
                        {risk.factors.length > 1 && (
                          <span className="opacity-70"> · +{risk.factors.length - 1} more</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold">{risk.score}</div>
                      <div className="text-xs opacity-70">{h}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Overdue TC tasks — workload-ranked */}
      <Section title="Overdue tasks" count={overdueTasks.length}>
        {overdueTasks.length === 0 ? (
          <Empty>No overdue tasks.</Empty>
        ) : (
          <ul className="space-y-2">
            {overdueTasks.map((t) => (
              <TaskRow key={t.id} t={t} tone="red" />
            ))}
          </ul>
        )}
      </Section>

      {/* Tasks due this week */}
      <Section title="Tasks due this week" count={weekTasks.length}>
        {weekTasks.length === 0 ? (
          <Empty>No tasks in the next 7 days.</Empty>
        ) : (
          <ul className="space-y-2">
            {weekTasks.map((t) => (
              <TaskRow key={t.id} t={t} tone="amber" />
            ))}
          </ul>
        )}
      </Section>

      {/* Overdue milestones */}
      <Section title="Overdue milestones" count={overdueMilestones.length}>
        {overdueMilestones.length === 0 ? (
          <Empty>Nothing overdue. Good place to be.</Empty>
        ) : (
          <ul className="space-y-2">
            {overdueMilestones.map((m) => (
              <MilestoneRow key={m.id} m={m} tone="red" />
            ))}
          </ul>
        )}
      </Section>

      {/* Week milestone deadlines */}
      <Section title="Milestone deadlines this week" count={weekDeadlines.length}>
        {weekDeadlines.length === 0 ? (
          <Empty>Nothing due in the next 7 days.</Empty>
        ) : (
          <ul className="space-y-2">
            {weekDeadlines.map((m) => (
              <MilestoneRow key={m.id} m={m} tone="amber" />
            ))}
          </ul>
        )}
      </Section>

      {/* Closing soon */}
      <Section title="Closing in the next 30 days" count={closingSoon.length}>
        {closingSoon.length === 0 ? (
          <Empty>Nothing scheduled to close this month.</Empty>
        ) : (
          <ul className="space-y-2">
            {closingSoon.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/transactions/${t.id}`}
                    className="font-medium hover:underline"
                  >
                    {t.contact.fullName}
                  </Link>
                  <div className="text-xs text-neutral-600">
                    {t.propertyAddress ?? "No address"} ·{" "}
                    {t.transactionType}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div>{fmtDate(t.closingDate)}</div>
                  {t.closingDate && (
                    <div className="text-xs text-neutral-500">
                      {fmtRel(t.closingDate)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Silent deals */}
      <Section
        title="Silent deals"
        subtitle="Active transactions with no communication in 7+ days"
        count={silentDeals.length}
      >
        {silentDeals.length === 0 ? (
          <Empty>Nothing stale — every active deal has recent activity.</Empty>
        ) : (
          <ul className="space-y-2">
            {silentDeals.map(({ txn, daysSince, lastTouch }) => (
              <li
                key={txn.id}
                className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/transactions/${txn.id}`}
                    className="font-medium hover:underline"
                  >
                    {txn.contact.fullName}
                  </Link>
                  <div className="text-xs text-neutral-600">
                    {txn.propertyAddress ?? "No address"} ·{" "}
                    {txn.transactionType}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-neutral-700">{daysSince}d ago</div>
                  <div className="text-xs text-neutral-500">
                    {fmtDate(lastTouch)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}

// --------------------------------------------------
// Sub-components
// --------------------------------------------------

function Section({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-h2 font-semibold">
            {title}
            {typeof count === "number" && count > 0 && (
              <span className="ml-2 font-normal text-text-muted">· {count}</span>
            )}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-muted">
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "neutral";
  href?: string;
}) {
  const toneMap = {
    red: "text-danger border-red-200 bg-red-50/60 dark:bg-red-950/30",
    amber: "text-accent-500 border-accent-200 bg-accent-100/40 dark:bg-accent-100/50",
    neutral: "text-text border-border bg-surface",
  };
  const content = (
    <div
      className={`rounded-md border p-4 shadow-sm transition-colors hover:border-border-strong ${toneMap[tone]}`}
    >
      <div className="reos-label opacity-80">{label}</div>
      <div className="mt-2 font-display text-display-md font-semibold tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}

function MilestoneRow({
  m,
  tone,
}: {
  m: {
    id: string;
    label: string;
    dueAt: Date | null;
    ownerRole: string;
    transaction: {
      id: string;
      propertyAddress: string | null;
      contact: { fullName: string };
    };
  };
  tone: "red" | "amber";
}) {
  const bg = tone === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50/50";
  return (
    <li
      className={`flex items-center justify-between rounded-md border p-3 ${bg}`}
    >
      <div className="min-w-0">
        <Link
          href={`/transactions/${m.transaction.id}`}
          className="font-medium hover:underline"
        >
          {m.label}
        </Link>
        <div className="text-xs text-neutral-700">
          {m.transaction.contact.fullName}
          {m.transaction.propertyAddress && (
            <>
              {" · "}
              <span className="text-neutral-500">
                {m.transaction.propertyAddress}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right text-sm">
        {m.dueAt ? (
          <>
            <div>{fmtDate(m.dueAt)}</div>
            <div className="text-xs text-neutral-500">{fmtRel(m.dueAt)}</div>
          </>
        ) : (
          <div className="text-xs italic text-neutral-400">no date</div>
        )}
      </div>
    </li>
  );
}

/** TC task row — same visual style as MilestoneRow but with title +
 * priority + assignee instead of milestone owner. Links to the
 * underlying transaction so Vicki can jump in and mark complete. */
function TaskRow({
  t,
  tone,
}: {
  t: {
    id: string;
    title: string;
    dueAt: Date | null;
    priority: string;
    assignedTo: string | null;
    transaction: {
      id: string;
      propertyAddress: string | null;
      contact: { fullName: string };
    };
  };
  tone: "red" | "amber";
}) {
  const bg =
    tone === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50/50";
  return (
    <li
      className={`flex items-center justify-between rounded-md border p-3 ${bg}`}
    >
      <div className="min-w-0">
        <Link
          href={`/transactions/${t.transaction.id}`}
          className="font-medium hover:underline"
        >
          {t.title}
        </Link>
        <div className="text-xs text-neutral-700">
          {t.transaction.contact.fullName}
          {t.transaction.propertyAddress && (
            <>
              {" · "}
              <span className="text-neutral-500">
                {t.transaction.propertyAddress}
              </span>
            </>
          )}
          {" · "}
          <span className="text-neutral-500">
            {t.assignedTo ?? "coordinator"}
          </span>
          {t.priority !== "normal" && (
            <>
              {" · "}
              <span
                className={
                  t.priority === "urgent"
                    ? "font-medium text-red-700"
                    : t.priority === "high"
                      ? "font-medium text-amber-700"
                      : "text-neutral-500"
                }
              >
                {t.priority}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right text-sm">
        {t.dueAt ? (
          <>
            <div>{fmtDate(t.dueAt)}</div>
            <div className="text-xs text-neutral-500">{fmtRel(t.dueAt)}</div>
          </>
        ) : (
          <div className="text-xs italic text-neutral-400">no date</div>
        )}
      </div>
    </li>
  );
}
