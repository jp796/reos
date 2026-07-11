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
import { PostCloseTickButton } from "./PostCloseTickButton";
import { TelegramNudge } from "./TelegramNudge";
import { TelegramService } from "@/services/integrations/TelegramService";
import { requireSession } from "@/lib/require-session";
import { dealVisibilityWhere } from "@/lib/deal-visibility";
import { cn } from "@/lib/cn";
import { isPostCloseNurture, classifyMilestone } from "@/lib/risk";

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

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const sp = await searchParams;
  // Scope: "mine" filters all queries to transactions assigned to
  // the acting user. "all" (default) shows everything in the account.
  const scope: "mine" | "all" = sp.scope === "mine" ? "mine" : "all";
  const actor = await requireSession();

  // First-time login: bounce to /onboarding when setup hasn't been
  // marked complete yet. Skips when actor is an unauth response
  // (middleware would have already redirected).
  if (!(actor instanceof Response)) {
    const onb = await prisma.account.findUnique({
      where: { id: actor.accountId },
      select: { settingsJson: true },
    });
    const settings = (onb?.settingsJson ?? {}) as Record<string, unknown>;
    const onboarding = (settings.onboarding ?? {}) as { completedAt?: string };
    if (!onboarding.completedAt) {
      const { redirect } = await import("next/navigation");
      redirect("/onboarding");
    }
  }
  // actor might be a Response when unauthenticated — middleware
  // redirects before we get here, so in practice this is always an
  // ActingUser. Narrow the type:
  const actingUserId = actor instanceof Response ? null : actor.userId;
  // Tenant scope — every query below MUST scope by accountId or it
  // leaks across tenants. Hard-fail to a deliberately-empty marker if
  // we somehow got past the auth gate without an actor.
  const actingAccountId =
    actor instanceof Response ? "__none__" : actor.accountId;
  const txnAssignedFilter =
    scope === "mine" && actingUserId
      ? { assignedUserId: actingUserId }
      : {};
  const txnTenantFilter =
    actor instanceof Response
      ? { accountId: actingAccountId }
      : { accountId: actingAccountId, ...dealVisibilityWhere(actor) };

  // Telegram nudge: prompt the user to connect their own chat if the
  // workspace has Telegram configured and they haven't linked yet.
  let showTelegramNudge = false;
  if (!(actor instanceof Response) && TelegramService.isConfigured()) {
    const me = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { telegramChatId: true },
    });
    showTelegramNudge = !me?.telegramChatId;
  }

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
        transaction: { ...txnTenantFilter, status: "active", ...txnAssignedFilter },
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
        transaction: { ...txnTenantFilter, status: "active", ...txnAssignedFilter },
      },
      include: {
        transaction: { include: { contact: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 25,
    }),
    prisma.transaction.findMany({
      where: { ...txnTenantFilter, status: "active", ...txnAssignedFilter },
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
        ...txnTenantFilter,
        status: "active",
        closingDate: { gte: now, lte: monthFromNow },
        ...txnAssignedFilter,
      },
      include: { contact: true },
      orderBy: { closingDate: "asc" },
      take: 15,
    }),
    prisma.pendingEmailMatch.count({
      where: { ...txnTenantFilter, status: "pending" },
    }),
    prisma.$queryRaw<
      Array<{ active: bigint; closed: bigint; total_contacts: bigint }>
    >`
      SELECT
        (SELECT COUNT(*) FROM transactions WHERE status='active' AND account_id = ${actingAccountId})::bigint AS active,
        (SELECT COUNT(*) FROM transactions WHERE status='closed' AND account_id = ${actingAccountId})::bigint AS closed,
        (SELECT COUNT(*) FROM contacts WHERE account_id = ${actingAccountId})::bigint AS total_contacts
    `,
    prisma.transaction.findMany({
      where: { ...txnTenantFilter, status: "active", ...txnAssignedFilter },
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
        transaction: { ...txnTenantFilter, status: "active", ...txnAssignedFilter },
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
        transaction: { ...txnTenantFilter, status: "active", ...txnAssignedFilter },
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

  // Phase 4 (§10 rule 1): post-close nurture (reviews, gifts, anniversaries)
  // must NOT sit in the active-risk / overdue queue. Split it out so the
  // harm queue stays scarce and post-close work has its own lane.
  const activeOverdueTasks = overdueTasks.filter((t) => !isPostCloseNurture(t.title));
  const postCloseOverdue = overdueTasks.filter((t) => isPostCloseNurture(t.title));

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

  // Phase 5 (§11) — "Prevent harm" queue: only the overdue milestones that
  // are genuine deal threats (contractual / closing / compliance), deduped
  // to one incident per deal so a single missed timeline doesn't spam the
  // queue (§10). Post-close / operational milestones never appear here.
  const harmSeen = new Set<string>();
  const harmMilestones = overdueMilestones.filter((m) => {
    const cat = classifyMilestone(m.type, m.label);
    const isHarm =
      cat === "contractual_deadline" ||
      cat === "closing_blocker" ||
      cat === "compliance_blocker";
    if (!isHarm) return false;
    const key = m.transaction.id;
    if (harmSeen.has(key)) return false; // one incident per deal
    harmSeen.add(key);
    return true;
  });

  const activeCount = Number(counts[0]?.active ?? 0);
  const closedCount = Number(counts[0]?.closed ?? 0);
  const contactCount = Number(counts[0]?.total_contacts ?? 0);

  return (
    <main className="mx-auto max-w-6xl">
      {showTelegramNudge && <TelegramNudge />}
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
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-border bg-surface">
            <Link
              href="/today"
              className={cn(
                "px-2.5 py-1 text-xs font-medium transition-colors",
                scope === "all"
                  ? "bg-brand-50 text-brand-700"
                  : "text-text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              All
            </Link>
            <Link
              href="/today?scope=mine"
              className={cn(
                "border-l border-border px-2.5 py-1 text-xs font-medium transition-colors",
                scope === "mine"
                  ? "bg-brand-50 text-brand-700"
                  : "text-text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              My queue
            </Link>
          </div>
          <PostCloseTickButton />
          <ReconcileSSButton />
        </div>
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

      {/* ── Decision queue (§11): harm first, then today, then waiting ── */}

      {/* 1. Prevent harm — only critical contractual/closing/compliance
          deadlines, one incident per deal. This is what can cause harm. */}
      <Section
        title="🚨 Prevent harm"
        subtitle="Critical contract, closing + compliance deadlines that are overdue"
        count={harmMilestones.length}
      >
        {harmMilestones.length === 0 ? (
          <Empty>
            Nothing critical is overdue. Atlas is watching every active deal&apos;s
            deadlines, documents, and silence.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {harmMilestones.map((m) => (
              <MilestoneRow key={m.id} m={m} tone="red" />
            ))}
          </ul>
        )}
      </Section>

      {/* At risk (secondary — scored deals overview) */}
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
                        {txn.propertyAddress ?? "No address"}
                      </Link>
                      <div className="text-xs opacity-80">
                        {txn.contact.fullName} · {txn.transactionType}
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

      {/* 2. Do today — active overdue TC tasks (post-close excluded, §10). */}
      <Section
        title="✅ Do today"
        subtitle="Tasks to act on now, highest priority first"
        count={activeOverdueTasks.length}
      >
        {activeOverdueTasks.length === 0 ? (
          <Empty>Nothing needs doing today. You&apos;re clear.</Empty>
        ) : (
          <ul className="space-y-2">
            {activeOverdueTasks.map((t) => (
              <TaskRow key={t.id} t={t} tone="red" />
            ))}
          </ul>
        )}
      </Section>

      {/* Post-close nurture — separate lane, never part of active risk (§10) */}
      {postCloseOverdue.length > 0 && (
        <Section title="Post-close follow-up" count={postCloseOverdue.length}>
          <ul className="space-y-2">
            {postCloseOverdue.map((t) => (
              <TaskRow key={t.id} t={t} tone="amber" />
            ))}
          </ul>
        </Section>
      )}

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
                className="flex items-center justify-between rounded-md border border-border bg-surface p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/transactions/${t.id}`}
                    className="font-medium hover:underline"
                  >
                    {t.propertyAddress ?? "No address"}
                  </Link>
                  <div className="text-xs text-text-muted">
                    {t.contact.fullName} ·{" "}
                    {t.transactionType}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div>{fmtDate(t.closingDate)}</div>
                  {t.closingDate && (
                    <div className="text-xs text-text-muted">
                      {fmtRel(t.closingDate)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 3. Waiting on others — party silence; blocked on someone else. */}
      <Section
        title="⏳ Waiting on others"
        subtitle="Active deals with no communication in 7+ days — nudge the other side"
        count={silentDeals.length}
      >
        {silentDeals.length === 0 ? (
          <Empty>Nothing stale — every active deal has recent activity.</Empty>
        ) : (
          <ul className="space-y-2">
            {silentDeals.map(({ txn, daysSince, lastTouch }) => (
              <li
                key={txn.id}
                className="flex items-center justify-between rounded-md border border-border bg-surface p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/transactions/${txn.id}`}
                    className="font-medium hover:underline"
                  >
                    {txn.propertyAddress ?? "No address"}
                  </Link>
                  <div className="text-xs text-text-muted">
                    {txn.contact.fullName} ·{" "}
                    {txn.transactionType}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-text">{daysSince}d ago</div>
                  <div className="text-xs text-text-muted">
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
  const bg =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100"
      : "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100";
  const subText =
    tone === "red"
      ? "text-red-800/80 dark:text-red-200/80"
      : "text-amber-800/80 dark:text-amber-200/80";
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
        <div className={`text-xs ${subText}`}>
          {m.transaction.propertyAddress ?? m.transaction.contact.fullName}
          {m.transaction.propertyAddress && <> · {m.transaction.contact.fullName}</>}
        </div>
      </div>
      <div className="text-right text-sm">
        {m.dueAt ? (
          <>
            <div>{fmtDate(m.dueAt)}</div>
            <div className={`text-xs ${subText}`}>{fmtRel(m.dueAt)}</div>
          </>
        ) : (
          <div className="text-xs italic opacity-70">no date</div>
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
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100"
      : "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100";
  const subText =
    tone === "red"
      ? "text-red-800/80 dark:text-red-200/80"
      : "text-amber-800/80 dark:text-amber-200/80";
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
        <div className={`text-xs ${subText}`}>
          {t.transaction.propertyAddress ?? t.transaction.contact.fullName}
          {t.transaction.propertyAddress && <> · {t.transaction.contact.fullName}</>}
          {" · "}
          {t.assignedTo ?? "coordinator"}
          {t.priority !== "normal" && (
            <>
              {" · "}
              <span
                className={
                  t.priority === "urgent"
                    ? "font-medium text-red-700 dark:text-red-300"
                    : t.priority === "high"
                      ? "font-medium text-amber-700 dark:text-amber-300"
                      : ""
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
            <div className={`text-xs ${subText}`}>{fmtRel(t.dueAt)}</div>
          </>
        ) : (
          <div className="text-xs italic opacity-70">no date</div>
        )}
      </div>
    </li>
  );
}
