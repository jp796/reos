import Link from "next/link";
import { prisma } from "@/lib/db";
import { ScanButton } from "./ScanButton";
import { EarnestMoneyScanButton } from "./EarnestMoneyScanButton";
import { InvoiceScanButton } from "./InvoiceScanButton";
import { PendingMatchesPanel } from "./PendingMatchesPanel";
import { PendingClosingUpdatesPanel } from "./PendingClosingUpdatesPanel";
import { CalendarSyncButton } from "./CalendarSyncButton";
import { QuickCloseButton } from "./QuickCloseButton";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

type StatusFilter = "open" | "closed" | "all";

const FILTER_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: "open", label: "Active" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

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
    active: "bg-brand-50 text-brand-700 ring-brand-200",
    pending: "bg-accent-100 text-accent-600 ring-accent-200",
    closed: "bg-surface-2 text-text-muted ring-border",
    dead: "bg-red-50 text-danger ring-red-200",
  };
  const cls =
    map[status] ?? "bg-surface-2 text-text-muted ring-border";
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter: StatusFilter =
    sp.status === "closed" || sp.status === "all" ? sp.status : "open";

  const where =
    filter === "all"
      ? {}
      : filter === "closed"
        ? { status: { in: ["closed", "dead"] } }
        : { status: { notIn: ["closed", "dead"] } };

  const [transactions, total, closedCount, activeCount] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        contact: true,
        milestones: { orderBy: { dueAt: "asc" } },
        _count: {
          select: { milestones: true, tasks: true, documents: true },
        },
      },
      take: 200,
    }),
    prisma.transaction.count(),
    prisma.transaction.count({
      where: { status: { in: ["closed", "dead"] } },
    }),
    prisma.transaction.count({
      where: { status: { notIn: ["closed", "dead"] } },
    }),
  ]);

  return (
    <main className="mx-auto max-w-6xl">
      <header className="flex items-start justify-between gap-6">
        <div>
          <div className="reos-label">Deals</div>
          <h1 className="mt-1 font-display text-display-lg font-semibold">
            Transactions
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            <span className="tabular-nums">{total.toLocaleString()}</span>{" "}
            total · auto-created from FUB stage/tag triggers during sync, or
            from title-company emails during a Gmail scan
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ScanButton />
          <EarnestMoneyScanButton />
          <InvoiceScanButton />
        </div>
      </header>

      {/* Status filter chips */}
      <div className="mt-6 flex items-center gap-1.5">
        {FILTER_TABS.map((tab) => {
          const count =
            tab.id === "open"
              ? activeCount
              : tab.id === "closed"
                ? closedCount
                : total;
          const active = filter === tab.id;
          const href = tab.id === "open" ? "/transactions" : `/transactions?status=${tab.id}`;
          return (
            <Link
              key={tab.id}
              href={href}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text",
              )}
            >
              {tab.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </Link>
          );
        })}
      </div>

      <PendingMatchesPanel />

      <PendingClosingUpdatesPanel />

      {transactions.length === 0 ? (
        <div className="mt-10 rounded-md border border-dashed border-border bg-surface p-12 text-center">
          <p className="text-text">No transactions yet.</p>
          <p className="mt-2 text-sm text-text-muted">
            Transactions auto-create on sync when a FUB contact&apos;s stage
            matches one of:{" "}
            <span className="font-mono text-xs">
              Under Contract · Pending · Closing · Active Buyer · Active Seller
            </span>
            , or when tags include{" "}
            <span className="font-mono text-xs">
              under contract · escrow · closing soon
            </span>
            .
          </p>
          <p className="mt-3 text-sm text-text-muted">
            Tag one of your FUB contacts (or flip their stage) and{" "}
            <Link href="/contacts" className="text-brand-700 underline">
              run a sync
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-2">
          {transactions.map((txn) => {
            const nextMs = txn.milestones.find(
              (m) => m.status === "pending" && m.dueAt > new Date(),
            );
            const overdue = txn.milestones.filter(
              (m) => m.status === "pending" && m.dueAt <= new Date(),
            );
            return (
              <div
                key={txn.id}
                className="group rounded-md border border-border bg-surface p-4 shadow-sm transition-colors hover:border-border-strong"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <Link
                    href={`/transactions/${txn.id}`}
                    className="group/link min-w-0 flex-1"
                  >
                    <div className="flex items-center gap-3">
                      <span className={statusBadge(txn.status)}>
                        {txn.status}
                      </span>
                      <span className="reos-label">{txn.transactionType}</span>
                      <span className="text-sm font-medium text-text group-hover/link:text-brand-700">
                        {txn.contact.fullName}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-text-muted">
                      {txn.propertyAddress || "No property address yet"}
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
                        {txn._count.milestones} milestones
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
                    <div className="flex items-center gap-1.5">
                      {txn.status !== "closed" && txn.status !== "dead" && (
                        <QuickCloseButton transactionId={txn.id} />
                      )}
                      {txn._count.milestones > 0 && (
                        <CalendarSyncButton
                          transactionId={txn.id}
                          contractStage={
                            (txn.contractStage as
                              | "offer"
                              | "counter"
                              | "executed"
                              | "unknown"
                              | null) ?? null
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
