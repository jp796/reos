import Link from "next/link";
import { prisma } from "@/lib/db";
import { ScanButton } from "./ScanButton";
import { EarnestMoneyScanButton } from "./EarnestMoneyScanButton";
import { PendingMatchesPanel } from "./PendingMatchesPanel";
import { PendingClosingUpdatesPanel } from "./PendingClosingUpdatesPanel";
import { CalendarSyncButton } from "./CalendarSyncButton";

export const dynamic = "force-dynamic";

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

export default async function TransactionsPage() {
  const transactions = await prisma.transaction.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      contact: true,
      milestones: {
        orderBy: { dueAt: "asc" },
      },
      _count: {
        select: { milestones: true, tasks: true, documents: true },
      },
    },
    take: 200,
  });

  const total = await prisma.transaction.count();

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
        </div>
      </header>

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
                <div className="flex items-start justify-between gap-4">
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
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right text-xs text-text-muted">
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
                    {txn._count.milestones > 0 && (
                      <CalendarSyncButton transactionId={txn.id} />
                    )}
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
