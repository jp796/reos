/**
 * /demo — public sandbox landing. Mirrors /transactions visually
 * (status pills, side badges, next-milestone summary) but reads
 * from an in-memory fixture instead of Prisma.
 *
 * SCRAPER GUARDRAILS — every transaction shown here is fabricated.
 * No tenant data, no PII, no internal IDs. Enumerating the fake
 * IDs (`demo-txn-*`) just returns more demo content. See
 * `_data/demoFixture.ts` for the rationale.
 */

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { DEMO_TRANSACTIONS, DEMO_HERO_ID } from "./_data/demoFixture";
import { cn } from "@/lib/cn";

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active:
      "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900/40",
    pending:
      "bg-accent-100 text-accent-600 ring-accent-200 dark:bg-accent-950/40 dark:text-accent-200 dark:ring-accent-900/40",
    closed: "bg-surface-2 text-text-muted ring-border",
  };
  const cls = map[status] ?? "bg-surface-2 text-text-muted ring-border";
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`;
}

export default function DemoTransactionsPage() {
  const total = DEMO_TRANSACTIONS.length;
  const active = DEMO_TRANSACTIONS.filter((t) => t.status === "active").length;
  const pending = DEMO_TRANSACTIONS.filter((t) => t.status === "pending").length;
  const closed = DEMO_TRANSACTIONS.filter((t) => t.status === "closed").length;

  return (
    <main className="mx-auto max-w-6xl">
      <header className="flex items-start justify-between gap-6">
        <div>
          <div className="reos-label">Deals</div>
          <h1 className="mt-1 font-display text-display-lg font-semibold">
            Transactions
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            <span className="tabular-nums">{total}</span> total ·{" "}
            {active} active · {pending} pending · {closed} closed
          </p>
        </div>
        <Link
          href={`/demo/transactions/${DEMO_HERO_ID}`}
          className="hidden items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 sm:inline-flex"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          Open the showcase deal
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </header>

      {/* Tour callout — the hero deal */}
      <Link
        href={`/demo/transactions/${DEMO_HERO_ID}`}
        className="mt-6 block rounded-md border border-brand-200 bg-brand-50 p-4 transition-colors hover:border-brand-400 dark:border-brand-900/40 dark:bg-brand-950/30"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
              Start here →
            </div>
            <div className="mt-1 font-display text-lg font-semibold text-text">
              1428 S Glenstone Ave · Springfield, MO
            </div>
            <p className="mt-1 text-sm text-text-muted">
              Buyer-side deal under contract — see the AI summary,
              full timeline, tasks, notes, and inspections.
            </p>
          </div>
          <ArrowRight
            className="h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300"
            strokeWidth={2}
          />
        </div>
      </Link>

      <div className="mt-8 space-y-2">
        {DEMO_TRANSACTIONS.map((txn) => {
          const nextMs = txn.milestones.find(
            (m) =>
              m.status === "pending" && m.dueAt != null && m.dueAt > new Date(),
          );
          const overdue = txn.milestones.filter(
            (m) =>
              m.status === "pending" && m.dueAt != null && m.dueAt <= new Date(),
          );
          return (
            <div
              key={txn.id}
              className="group rounded-md border border-border bg-surface p-4 shadow-sm transition-colors hover:border-border-strong"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <Link
                  href={`/demo/transactions/${txn.id}`}
                  className="group/link min-w-0 flex-1"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={statusBadge(txn.status)}>
                      {txn.status}
                    </span>
                    <span className="reos-label">{txn.transactionType}</span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1",
                        "bg-accent-100 text-accent-600 ring-accent-200",
                      )}
                      title="Representation"
                    >
                      {txn.side === "buy"
                        ? "Buyer"
                        : txn.side === "sell"
                          ? "Seller"
                          : "Dual"}
                    </span>
                    <span className="text-sm font-medium text-text group-hover/link:text-brand-700">
                      {txn.contact.fullName}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-text-muted">
                    {txn.propertyAddress}, {txn.city}, {txn.state} {txn.zip}
                    {txn.contact.sourceName && (
                      <>
                        <span className="mx-2 text-text-subtle">·</span>
                        {txn.contact.sourceName}
                      </>
                    )}
                  </div>
                </Link>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <div className="text-xs text-text-muted sm:text-right">
                    <div className="tabular-nums">
                      {txn.milestones.length} milestones
                      {overdue.length > 0 && (
                        <span className="ml-1 text-danger">
                          · {overdue.length} overdue
                        </span>
                      )}
                    </div>
                    {nextMs && (
                      <div className="mt-0.5">
                        Next: {nextMs.label} —{" "}
                        <span className="tabular-nums">
                          {formatDate(nextMs.dueAt)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10 rounded-md border border-dashed border-border bg-surface-2/40 p-6 text-center">
        <h2 className="font-display text-xl font-semibold">
          Ready to run your own deals like this?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Connect your Gmail in under a minute. 1 deal free, no card required.
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
