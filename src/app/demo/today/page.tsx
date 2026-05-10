/**
 * /demo/today — public sandbox "chief of staff" view. Mini version
 * of /today: 3 overdue items, 2 closing-this-week, 1 needs-
 * attention. All data derives live from the demo fixture so dates
 * stay current.
 *
 * SCRAPER GUARDRAILS — fully synthetic data, see _data/demoFixture.ts.
 */

import Link from "next/link";
import { AlertCircle, CalendarClock, Sparkles, ArrowRight } from "lucide-react";
import {
  getTodayOverdue,
  getTodayClosingThisWeek,
  getTodayNeedsAttention,
} from "../_data/demoFixture";

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function fmtRel(d: Date) {
  const ms = d.getTime() - Date.now();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days}d`;
  return `${-days}d ago`;
}

export default function DemoTodayPage() {
  const overdue = getTodayOverdue();
  const closingSoon = getTodayClosingThisWeek();
  const needsAttention = getTodayNeedsAttention();

  return (
    <main className="mx-auto max-w-5xl">
      <header>
        <div className="reos-label">Chief of staff</div>
        <h1 className="mt-1 font-display text-display-lg font-semibold">
          Today
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          The 6 things that matter right now, ranked by urgency.
        </p>
      </header>

      {/* Overdue */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-danger">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          Overdue ({overdue.length})
        </h2>
        <ul className="mt-3 space-y-2">
          {overdue.map((item, idx) => (
            <li
              key={`${item.transactionId}-${idx}`}
              className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/30"
            >
              <Link
                href={`/demo/transactions/${item.transactionId}`}
                className="block"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {item.label}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-text-muted">
                      {item.contactName} · {item.propertyAddress}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-danger">
                    <div className="font-medium">{fmtRel(item.dueAt)}</div>
                    <div className="opacity-80">{fmtDate(item.dueAt)}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Closing this week */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-text-muted">
          <CalendarClock className="h-4 w-4" strokeWidth={2} />
          Closing this week ({closingSoon.length})
        </h2>
        <ul className="mt-3 space-y-2">
          {closingSoon.map((item, idx) => (
            <li
              key={`${item.transactionId}-${idx}`}
              className="rounded-md border border-border bg-surface p-3"
            >
              <Link
                href={`/demo/transactions/${item.transactionId}`}
                className="block"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {item.contactName}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-text-muted">
                      {item.propertyAddress}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-text-muted">
                    <div className="font-medium text-text">
                      {fmtRel(item.dueAt)}
                    </div>
                    <div>{fmtDate(item.dueAt)}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Needs attention */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-accent-700 dark:text-accent-300">
          <Sparkles className="h-4 w-4" strokeWidth={2} />
          Needs your attention
        </h2>
        <ul className="mt-3 space-y-2">
          {needsAttention.map((item, idx) => (
            <li
              key={`${item.transactionId}-${idx}`}
              className="rounded-md border border-accent-200 bg-accent-100/40 p-3 dark:border-accent-900/40 dark:bg-accent-950/30"
            >
              <Link
                href={`/demo/transactions/${item.transactionId}`}
                className="block"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {item.label}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-text-muted">
                      {item.contactName} · {item.propertyAddress}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-accent-700 dark:text-accent-300">
                    <div className="font-medium">{fmtRel(item.dueAt)}</div>
                    <div className="opacity-80">{fmtDate(item.dueAt)}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-12 rounded-md border border-dashed border-border bg-surface-2/40 p-6 text-center">
        <h2 className="font-display text-xl font-semibold">
          Wake up to this every morning.
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          REOS scans your inbox overnight and ranks tomorrow&rsquo;s fires
          before you pour your coffee.
        </p>
        <Link
          href="/login?signup=1"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
        >
          <Sparkles className="h-4 w-4" strokeWidth={2} />
          Start free
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>
    </main>
  );
}
