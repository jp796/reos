/**
 * /demo/transactions/[id] — public sandbox transaction detail.
 *
 * Mirrors the structure of /transactions/[id] (header → facts grid
 * → AI summary → timeline → tasks → notes → inspections →
 * documents) so prospects feel the same product. All data comes
 * from `_data/demoFixture.ts`; mutations are intercepted by
 * DemoGuard and surface a friendly toast.
 *
 * SCRAPER GUARDRAILS — every value here is fabricated. There's no
 * real customer, transaction, or document behind any ID. The
 * `notFound()` path renders a friendly "demo deal doesn't exist"
 * note rather than 404'ing into the auth-gated app.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertCircle,
  FileText,
} from "lucide-react";
import { getDemoTransactionById } from "../../_data/demoFixture";
import { DemoButton } from "../../_components/DemoButton";

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtRel(d: Date | null | undefined) {
  if (!d) return "—";
  const ms = d.getTime() - Date.now();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days}d`;
  return `${-days}d ago`;
}
function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-brand-50 text-brand-700 ring-brand-200",
    pending: "bg-accent-100 text-accent-600 ring-accent-200",
    closed: "bg-surface-2 text-text-muted ring-border",
  };
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${map[status] ?? "bg-surface-2 text-text-muted ring-border"}`;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="reos-label opacity-80">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

export default async function DemoTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const txn = getDemoTransactionById(id);
  if (!txn) notFound();

  const overdue = txn.milestones.filter(
    (m) => m.status === "pending" && m.dueAt != null && m.dueAt <= new Date(),
  );

  return (
    <main className="mx-auto max-w-5xl">
      <Link
        href="/demo"
        className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={2} />
        All transactions
      </Link>

      {/* Header */}
      <header className="mt-3 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={statusBadge(txn.status)}>{txn.status}</span>
            <span className="reos-label">{txn.transactionType}</span>
            <span className="inline-flex items-center rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-600 ring-1 ring-accent-200">
              {txn.side === "buy"
                ? "Buyer"
                : txn.side === "sell"
                  ? "Seller"
                  : "Dual"}
            </span>
            {txn.contractStage && (
              <span className="inline-flex items-center rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                {txn.contractStage}
              </span>
            )}
          </div>
          <h1 className="mt-2 truncate font-display text-display-lg font-semibold">
            {txn.propertyAddress}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {txn.city}, {txn.state} {txn.zip} · {txn.contact.fullName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DemoButton action="Sync to calendar" variant="secondary">
            Sync to calendar
          </DemoButton>
          <DemoButton action="Delete transaction" variant="danger">
            Delete
          </DemoButton>
        </div>
      </header>

      {/* Facts grid */}
      <section className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <Fact label="Contact email" value={txn.contact.primaryEmail ?? "—"} />
        <Fact label="Contact phone" value={txn.contact.primaryPhone ?? "—"} />
        <Fact label="Source" value={txn.contact.sourceName ?? "—"} />
        <Fact label="Assigned agent" value={txn.assignedAgentName ?? "—"} />
        <Fact label="Contract date" value={fmtDate(txn.contractDate)} />
        <Fact label="Closing date" value={fmtDate(txn.closingDate)} />
        <Fact label="Inspection" value={fmtDate(txn.inspectionDate)} />
        <Fact label="Title commitment" value={fmtDate(txn.titleDeadline)} />
        <Fact label="Appraisal" value={fmtDate(txn.appraisalDate)} />
        <Fact label="Financing deadline" value={fmtDate(txn.financingDeadline)} />
        <Fact label="Lender" value={txn.lenderName ?? "—"} />
        <Fact label="Title co." value={txn.titleCompanyName ?? "—"} />
        <Fact label="List price" value={fmtMoney(txn.listPrice)} />
        <Fact
          label="Earnest money"
          value={fmtDate(txn.earnestMoneyDueDate)}
        />
      </section>

      {/* AI Summary */}
      {txn.aiSummary && (
        <section className="mt-8 rounded-md border border-brand-200 bg-brand-50/40 p-5 dark:border-brand-900/40 dark:bg-brand-950/20">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles
                className="h-4 w-4 text-brand-700 dark:text-brand-300"
                strokeWidth={2}
              />
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                AI summary
              </h2>
              {txn.aiSummaryUpdatedAt && (
                <span className="text-xs text-text-muted">
                  · updated {fmtRel(txn.aiSummaryUpdatedAt)}
                </span>
              )}
            </div>
            <DemoButton action="Regenerate AI summary" variant="ghost">
              Regenerate
            </DemoButton>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-text">
            {txn.aiSummary}
          </p>
        </section>
      )}

      {/* Notes */}
      {txn.notes.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-muted">
              Notes
            </h2>
            <DemoButton action="Add note" variant="secondary">
              + Add note
            </DemoButton>
          </div>
          <div className="space-y-2">
            {txn.notes.map((n) => (
              <div
                key={n.id}
                className="rounded-md border border-border bg-surface p-3"
              >
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span className="font-medium text-text">{n.authorName}</span>
                  <span>{fmtRel(n.createdAt)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-line text-sm text-text">
                  {n.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Timeline */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-muted">
            Timeline
          </h2>
          {overdue.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-danger ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/40">
              <AlertCircle className="h-3 w-3" strokeWidth={2} />
              {overdue.length} overdue
            </span>
          )}
        </div>
        <ol className="space-y-1.5">
          {txn.milestones.map((ms) => {
            const isOverdue =
              ms.status === "pending" &&
              ms.dueAt != null &&
              ms.dueAt <= new Date();
            const tone = ms.completedAt
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30"
              : isOverdue
                ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30"
                : "border-border bg-surface";
            const Icon = ms.completedAt
              ? CheckCircle2
              : isOverdue
                ? AlertCircle
                : Circle;
            const iconTone = ms.completedAt
              ? "text-emerald-600 dark:text-emerald-400"
              : isOverdue
                ? "text-danger"
                : "text-text-muted";
            return (
              <li
                key={ms.id}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 ${tone}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${iconTone}`}
                    strokeWidth={2}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text">
                      {ms.label}
                    </div>
                    <div className="text-xs text-text-muted">
                      {ms.ownerRole} ·{" "}
                      {ms.completedAt
                        ? `completed ${fmtRel(ms.completedAt)}`
                        : ms.dueAt
                          ? `${fmtDate(ms.dueAt)} (${fmtRel(ms.dueAt)})`
                          : "no date"}
                    </div>
                  </div>
                </div>
                {!ms.completedAt && (
                  <DemoButton action={`Complete ${ms.label}`} variant="ghost">
                    Mark done
                  </DemoButton>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Tasks */}
      {txn.tasks.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-muted">
              Tasks
            </h2>
            <DemoButton action="Add task" variant="secondary">
              + Add task
            </DemoButton>
          </div>
          <ul className="space-y-1.5">
            {txn.tasks.map((t) => {
              const isOverdue =
                !t.completedAt && t.dueAt != null && t.dueAt <= new Date();
              return (
                <li
                  key={t.id}
                  className="flex items-start gap-3 rounded-md border border-border bg-surface p-3"
                >
                  <DemoButton
                    action={
                      t.completedAt ? `Reopen task: ${t.title}` : `Complete: ${t.title}`
                    }
                    variant="ghost"
                    className="!p-1"
                  >
                    {t.completedAt ? (
                      <CheckCircle2
                        className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                        strokeWidth={2}
                      />
                    ) : (
                      <Circle
                        className="h-4 w-4 text-text-muted"
                        strokeWidth={2}
                      />
                    )}
                  </DemoButton>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-sm ${t.completedAt ? "text-text-muted line-through" : "text-text"}`}
                    >
                      {t.title}
                    </div>
                    {t.description && (
                      <div className="mt-0.5 text-xs text-text-muted">
                        {t.description}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-text-muted">
                    {t.completedAt ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {fmtRel(t.completedAt)}
                      </span>
                    ) : (
                      <span className={isOverdue ? "text-danger" : ""}>
                        {fmtRel(t.dueAt)}
                      </span>
                    )}
                    {t.assignedTo && (
                      <div className="mt-0.5">@{t.assignedTo}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Inspections */}
      {txn.inspections.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-muted">
              Inspections
            </h2>
            <DemoButton action="Add inspection" variant="secondary">
              + Add inspection
            </DemoButton>
          </div>
          <div className="space-y-1.5">
            {txn.inspections.map((insp) => (
              <div
                key={insp.id}
                className="rounded-md border border-border bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-text">
                      {insp.label}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {insp.vendorName ?? "Vendor TBD"}
                      {insp.scheduledAt && (
                        <>
                          <span className="mx-1.5 text-text-subtle">·</span>
                          {fmtDate(insp.scheduledAt)}
                        </>
                      )}
                    </div>
                    {insp.vendorNote && (
                      <div className="mt-1 text-xs text-text-muted">
                        {insp.vendorNote}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      insp.completedAt
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/40"
                        : "bg-surface-2 text-text-muted ring-border"
                    }`}
                  >
                    {insp.completedAt ? "Completed" : "Scheduled"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Documents */}
      {txn.documents.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-muted">
              Documents
            </h2>
            <DemoButton action="Upload document" variant="secondary">
              + Upload
            </DemoButton>
          </div>
          <ul className="divide-y divide-border rounded-md border border-border bg-surface">
            {txn.documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileText
                    className="h-4 w-4 shrink-0 text-text-muted"
                    strokeWidth={1.8}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text">{d.name}</div>
                    <div className="text-xs text-text-muted">
                      {d.category} · uploaded {fmtRel(d.uploadedAt)}
                    </div>
                  </div>
                </div>
                <DemoButton action={`Open ${d.name}`} variant="ghost">
                  Open
                </DemoButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Conversion CTA */}
      <div className="mt-12 rounded-md border border-dashed border-border bg-surface-2/40 p-6 text-center">
        <h2 className="font-display text-xl font-semibold">
          This is what your next 30 days looks like with REOS.
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          AI reads your contracts, builds the timeline, watches your inbox,
          and sends you one daily brief. Set it up in under a minute.
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
