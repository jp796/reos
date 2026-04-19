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
  ]);

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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-6 flex items-center gap-4 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-900">
          Home
        </Link>
        <span className="text-neutral-300">·</span>
        <Link href="/contacts" className="hover:text-neutral-900">
          Contacts
        </Link>
        <span className="text-neutral-300">·</span>
        <Link href="/transactions" className="hover:text-neutral-900">
          Transactions
        </Link>
      </nav>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-neutral-600">
          What needs your attention right now · {activeCount} active ·{" "}
          {closedCount} closed · {contactCount.toLocaleString()} contacts
        </p>
      </header>

      {/* Quick-stats strip */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      {/* Overdue */}
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

      {/* Week deadlines */}
      <Section title="Deadlines this week" count={weekDeadlines.length}>
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
    <section className="mt-8">
      <div className="mb-2 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-medium">
            {title}
            {typeof count === "number" && count > 0 && (
              <span className="ml-2 text-neutral-500">· {count}</span>
            )}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-200 p-4 text-center text-sm text-neutral-500">
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
    red: "text-red-700 border-red-200 bg-red-50",
    amber: "text-amber-800 border-amber-200 bg-amber-50",
    neutral: "text-neutral-700 border-neutral-200 bg-white",
  };
  const content = (
    <div className={`rounded-lg border p-3 ${toneMap[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold">
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
    dueAt: Date;
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
        <div>{fmtDate(m.dueAt)}</div>
        <div className="text-xs text-neutral-500">{fmtRel(m.dueAt)}</div>
      </div>
    </li>
  );
}
