import Link from "next/link";
import { prisma } from "@/lib/db";
import { TransactionsToolbar } from "./TransactionsToolbar";
import { GmailSearchPanel } from "./GmailSearchPanel";
import { AcceptedContractScanPanel } from "./AcceptedContractScanPanel";
import { QuickDeadButton } from "./QuickDeadButton";
import { PendingMatchesPanel } from "./PendingMatchesPanel";
import { PendingClosingUpdatesPanel } from "./PendingClosingUpdatesPanel";
import { CalendarSyncButton } from "./CalendarSyncButton";
import { QuickCloseButton } from "./QuickCloseButton";
import { cn } from "@/lib/cn";
import { readEntitlements } from "@/lib/entitlements";
import { dealVisibilityWhere } from "@/lib/deal-visibility";

export const dynamic = "force-dynamic";

type StatusFilter = "open" | "closed" | "all";
type RepFilter = "any" | "buy" | "sell" | "both";
type ScopeFilter = "all" | "mine";
/** Investor-module lens (spec §1): split the unified board by deal kind
 * without fragmenting the data. "investment" = deals whose Asset is
 * principal-owned; "retail" = agency deals + every legacy transaction
 * (assetId null). Only rendered when the account holds the investor
 * entitlement. */
type LensFilter = "all" | "retail" | "investment";

const FILTER_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: "open", label: "Active" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

const REP_TABS: Array<{ id: RepFilter; label: string; dbValue?: string }> = [
  { id: "any", label: "All sides" },
  { id: "buy", label: "Buyer", dbValue: "buy" },
  { id: "sell", label: "Seller", dbValue: "sell" },
  { id: "both", label: "Dual", dbValue: "both" },
];

function buildHref(
  status: StatusFilter,
  rep: RepFilter,
  scope: ScopeFilter = "all",
  lens: LensFilter = "all",
): string {
  const params = new URLSearchParams();
  if (status !== "open") params.set("status", status);
  if (rep !== "any") params.set("rep", rep);
  if (scope !== "all") params.set("scope", scope);
  if (lens !== "all") params.set("lens", lens);
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

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
    closed:
      "bg-surface-2 text-text-muted ring-border",
    dead: "bg-red-50 text-danger ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/40",
  };
  const cls =
    map[status] ?? "bg-surface-2 text-text-muted ring-border";
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; rep?: string; scope?: string; lens?: string }>;
}) {
  const { requireSession } = await import("@/lib/require-session");
  const actor = await requireSession();
  const actingUserId = actor instanceof Response ? null : actor.userId;
  // Tenant scope — every query below MUST include this. Without it
  // the list leaks every transaction across every tenant in the DB.
  // Base scope = tenant + per-deal visibility. Folding visibility in
  // here means the main query AND every count below respect it in one
  // shot — no restricted deal can leak through a forgotten count.
  const accountWhere =
    actor instanceof Response
      ? { accountId: "__none__" }
      : { accountId: actor.accountId, ...dealVisibilityWhere(actor) };

  // Investor entitlement gates the Retail/Investment lens. Retail-only
  // accounts never see it (and a stale ?lens= is ignored for them).
  const entitlements =
    actor instanceof Response ? [] : await readEntitlements(actor.accountId);
  const showLens = entitlements.includes("investor");

  const sp = await searchParams;
  const filter: StatusFilter =
    sp.status === "closed" || sp.status === "all" ? sp.status : "open";
  const rep: RepFilter =
    sp.rep === "buy" || sp.rep === "sell" || sp.rep === "both" ? sp.rep : "any";
  const scope: ScopeFilter = sp.scope === "mine" ? "mine" : "all";
  const lens: LensFilter =
    showLens && (sp.lens === "retail" || sp.lens === "investment")
      ? sp.lens
      : "all";
  const scopeWhere =
    scope === "mine" && actingUserId ? { assignedUserId: actingUserId } : {};

  const statusWhere =
    filter === "all"
      ? {}
      : filter === "closed"
        ? { status: { in: ["closed", "dead"] } }
        : { status: { notIn: ["closed", "dead"] } };

  const repWhere = rep === "any" ? {} : { side: rep };

  // Lens → Asset.representation. "investment" = principal-owned Assets;
  // "retail" = agency Assets + every legacy txn with no Asset (assetId
  // null), so existing deals stay visible under the retail lens.
  const lensWhere =
    lens === "investment"
      ? { asset: { representation: "principal" } }
      : lens === "retail"
        ? {
            OR: [
              { assetId: null },
              { asset: { representation: { not: "principal" } } },
            ],
          }
        : {};

  const where = {
    ...accountWhere,
    ...statusWhere,
    ...repWhere,
    ...scopeWhere,
    ...lensWhere,
  };

  const [
    transactions,
    total,
    closedCount,
    activeCount,
    buyCount,
    sellCount,
    bothCount,
  ] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        contact: true,
        milestones: { orderBy: { dueAt: "asc" } },
        assignedUser: { select: { name: true, email: true } },
        asset: { select: { representation: true, strategy: true } },
        _count: {
          select: { milestones: true, tasks: true, documents: true },
        },
      },
      take: 200,
    }),
    prisma.transaction.count({ where: accountWhere }),
    prisma.transaction.count({
      where: { ...accountWhere, status: { in: ["closed", "dead"] } },
    }),
    prisma.transaction.count({
      where: { ...accountWhere, status: { notIn: ["closed", "dead"] } },
    }),
    // Rep-side counts, scoped to the currently-active status filter so
    // the numbers reflect what the user is looking at.
    prisma.transaction.count({ where: { ...accountWhere, ...statusWhere, side: "buy" } }),
    prisma.transaction.count({ where: { ...accountWhere, ...statusWhere, side: "sell" } }),
    prisma.transaction.count({ where: { ...accountWhere, ...statusWhere, side: "both" } }),
  ]);

  // Lens counts — only queried for investor-entitled accounts (scoped to
  // the active status filter, like the rep counts).
  let retailCount = 0;
  let investmentCount = 0;
  if (showLens) {
    [investmentCount, retailCount] = await Promise.all([
      prisma.transaction.count({
        where: {
          ...accountWhere,
          ...statusWhere,
          asset: { representation: "principal" },
        },
      }),
      prisma.transaction.count({
        where: {
          ...accountWhere,
          ...statusWhere,
          OR: [
            { assetId: null },
            { asset: { representation: { not: "principal" } } },
          ],
        },
      }),
    ]);
  }

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
        <TransactionsToolbar />
      </header>

      {/* Lens — Retail / Investment / All (investor entitlement only).
          Top-level cut of the unified board per spec §1; data is never
          split, just filtered. */}
      {showLens && (
        <div className="mt-5 inline-flex overflow-hidden rounded-md border border-border bg-surface">
          {(
            [
              { id: "all", label: "All" },
              { id: "retail", label: "Retail" },
              { id: "investment", label: "Investment" },
            ] as Array<{ id: LensFilter; label: string }>
          ).map((tab, i) => {
            const active = lens === tab.id;
            const count =
              tab.id === "retail"
                ? retailCount
                : tab.id === "investment"
                  ? investmentCount
                  : retailCount + investmentCount;
            return (
              <Link
                key={tab.id}
                href={buildHref(filter, rep, scope, tab.id)}
                className={cn(
                  "px-3 py-1 text-xs font-medium transition-colors",
                  i > 0 && "border-l border-border",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {tab.label}
                <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Scope toggle — "my queue" vs all */}
      <div
        className={cn(
          "inline-flex overflow-hidden rounded-md border border-border bg-surface",
          showLens ? "mt-3" : "mt-5",
        )}
      >
        <Link
          href={buildHref(filter, rep, "all", lens)}
          className={cn(
            "px-3 py-1 text-xs font-medium transition-colors",
            scope === "all"
              ? "bg-brand-50 text-brand-700"
              : "text-text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          All transactions
        </Link>
        <Link
          href={buildHref(filter, rep, "mine", lens)}
          className={cn(
            "border-l border-border px-3 py-1 text-xs font-medium transition-colors",
            scope === "mine"
              ? "bg-brand-50 text-brand-700"
              : "text-text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          My queue
        </Link>
      </div>

      {/* Status filter chips */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {FILTER_TABS.map((tab) => {
          const count =
            tab.id === "open"
              ? activeCount
              : tab.id === "closed"
                ? closedCount
                : total;
          const active = filter === tab.id;
          return (
            <Link
              key={tab.id}
              href={buildHref(tab.id, rep, scope, lens)}
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

      {/* Representation filter — Buyer / Seller / Dual (scoped to the
          active status filter) */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {REP_TABS.map((tab) => {
          const count =
            tab.id === "any"
              ? filter === "open"
                ? activeCount
                : filter === "closed"
                  ? closedCount
                  : total
              : tab.id === "buy"
                ? buyCount
                : tab.id === "sell"
                  ? sellCount
                  : bothCount;
          const active = rep === tab.id;
          return (
            <Link
              key={tab.id}
              href={buildHref(filter, tab.id, scope, lens)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-accent-400 bg-accent-100 text-accent-600"
                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text",
              )}
            >
              {tab.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </Link>
          );
        })}
      </div>

      <details className="group mt-8 rounded-md border border-border bg-surface">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-text-muted hover:text-text">
          <span className="inline-flex items-center gap-2">
            <span className="text-text">Find in Gmail</span>
            <span className="text-xs text-text-subtle">
              search by name/address, or scan for accepted contracts
            </span>
          </span>
        </summary>
        <div className="border-t border-border p-4">
          <GmailSearchPanel />
          <AcceptedContractScanPanel />
        </div>
      </details>

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
        (() => {
          const renderRow = (txn: (typeof transactions)[number]) => {
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
                    href={`/transactions/${txn.id}`}
                    className="group/link min-w-0 flex-1"
                  >
                    <div className="text-base font-bold text-text group-hover/link:text-brand-700">
                      {txn.propertyAddress || "No property address yet"}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className={statusBadge(txn.status)}>
                        {txn.status}
                      </span>
                      <span className="reos-label">{txn.transactionType}</span>
                      {txn.side && (
                        <span
                          className="inline-flex items-center rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-600 ring-1 ring-accent-200"
                          title="Representation"
                        >
                          {txn.side === "buy"
                            ? "Buyer"
                            : txn.side === "sell"
                              ? "Seller"
                              : "Dual"}
                        </span>
                      )}
                      <span className="text-sm font-medium text-text">
                        {txn.contact.fullName}
                      </span>
                      {txn.assignedUser && (
                        <span
                          className="inline-flex items-center rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-muted"
                          title={`Assigned to ${txn.assignedUser.name ?? txn.assignedUser.email}`}
                        >
                          👤{" "}
                          {(
                            txn.assignedUser.name ?? txn.assignedUser.email
                          ).split(" ")[0]}
                        </span>
                      )}
                      {txn.contact.sourceName && (
                        <span className="text-xs text-text-muted">
                          · {txn.contact.sourceName}
                        </span>
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      {txn.status !== "closed" && txn.status !== "dead" && (
                        <>
                          <QuickCloseButton transactionId={txn.id} />
                          <QuickDeadButton transactionId={txn.id} />
                        </>
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
          };

          // Investor-entitled accounts viewing "All" get the list split
          // into Investment vs Retail sections (organizational clarity).
          // A specific lens (Retail/Investment) or non-investor accounts
          // render one flat list.
          const grouped = showLens && lens === "all";
          if (!grouped) {
            return (
              <div className="mt-8 space-y-2">{transactions.map(renderRow)}</div>
            );
          }
          const investment = transactions.filter(
            (t) => t.asset?.representation === "principal",
          );
          const retail = transactions.filter(
            (t) => t.asset?.representation !== "principal",
          );
          return (
            <div className="mt-8 space-y-6">
              {investment.length > 0 && (
                <section>
                  <div className="reos-label mb-2">
                    Investment deals · {investment.length}
                  </div>
                  <div className="space-y-2">{investment.map(renderRow)}</div>
                </section>
              )}
              {retail.length > 0 && (
                <section>
                  <div className="reos-label mb-2">
                    Retail deals · {retail.length}
                  </div>
                  <div className="space-y-2">{retail.map(renderRow)}</div>
                </section>
              )}
            </div>
          );
        })()
      )}
    </main>
  );
}
