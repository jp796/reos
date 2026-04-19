import Link from "next/link";
import { prisma } from "@/lib/db";
import { ScanButton } from "./ScanButton";
import { PendingMatchesPanel } from "./PendingMatchesPanel";
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
    active: "bg-emerald-100 text-emerald-800",
    pending: "bg-amber-100 text-amber-800",
    closed: "bg-neutral-200 text-neutral-700",
    dead: "bg-red-100 text-red-800",
  };
  const cls = map[status] ?? "bg-neutral-100 text-neutral-700";
  return `rounded-full px-2 py-0.5 text-xs font-medium ${cls}`;
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
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="mb-6 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-900">
          ← Home
        </Link>
        <span className="mx-2 text-neutral-300">·</span>
        <Link href="/contacts" className="hover:text-neutral-900">
          Contacts
        </Link>
      </nav>

      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Transactions</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {total.toLocaleString()} transaction{total === 1 ? "" : "s"} ·
            auto-created from FUB stage/tag triggers during sync, or from
            title-company emails during a Gmail scan
          </p>
        </div>
        <ScanButton />
      </div>

      <PendingMatchesPanel />

      {transactions.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-neutral-300 bg-white p-12 text-center">
          <p className="text-neutral-600">No transactions yet.</p>
          <p className="mt-2 text-sm text-neutral-500">
            Transactions auto-create on sync when a FUB contact&apos;s stage
            matches one of:{" "}
            <span className="font-mono">
              Under Contract · Pending · Closing · Active Buyer · Active Seller
            </span>
            , or when tags include{" "}
            <span className="font-mono">
              under contract · escrow · closing soon
            </span>
            .
          </p>
          <p className="mt-3 text-sm text-neutral-500">
            Tag one of your FUB contacts (or flip their stage) and{" "}
            <Link href="/contacts" className="underline">
              run a sync
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
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
                className="rounded-lg border border-neutral-200 bg-white p-4 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className={statusBadge(txn.status)}>
                        {txn.status}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-neutral-500">
                        {txn.transactionType}
                      </span>
                      <span className="text-sm font-medium">
                        {txn.contact.fullName}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-neutral-600">
                      {txn.propertyAddress || "No property address yet"}
                      {txn.contact.sourceName && (
                        <>
                          <span className="mx-2 text-neutral-300">·</span>
                          {txn.contact.sourceName}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right text-xs text-neutral-500">
                      <div>
                        {txn._count.milestones} milestones
                        {overdue.length > 0 && (
                          <span className="ml-1 text-red-600">
                            · {overdue.length} overdue
                          </span>
                        )}
                      </div>
                      {nextMs && (
                        <div className="mt-0.5">
                          Next: {nextMs.label} — {formatDate(nextMs.dueAt)}
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
