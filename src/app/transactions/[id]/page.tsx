import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CalendarSyncButton } from "../CalendarSyncButton";
import { FinancialsForm } from "./FinancialsForm";
import { AISummaryPanel } from "./AISummaryPanel";
import { SmartFolderSection } from "./SmartFolderSection";
import { ContractUploadPanel } from "./ContractUploadPanel";
import { ForwardingPanel } from "./ForwardingPanel";
import { SMART_FOLDER_CUTOFF } from "@/services/automation/SmartFolderService";
import {
  RiskScoringService,
  riskHealth,
  riskHealthTone,
} from "@/services/core/RiskScoringService";

export const dynamic = "force-dynamic";

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
    active: "bg-emerald-100 text-emerald-800",
    pending: "bg-amber-100 text-amber-800",
    closed: "bg-neutral-200 text-neutral-700",
    dead: "bg-red-100 text-red-800",
  };
  return `rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-neutral-100 text-neutral-700"}`;
}

function msStatusTone(ms: {
  status: string;
  dueAt: Date;
  completedAt: Date | null;
}) {
  if (ms.completedAt) return "border-emerald-200 bg-emerald-50";
  const overdue = ms.status === "pending" && ms.dueAt <= new Date();
  if (overdue) return "border-red-200 bg-red-50";
  return "border-neutral-200 bg-white";
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: {
      contact: true,
      milestones: { orderBy: { dueAt: "asc" } },
      tasks: { orderBy: { dueAt: "asc" } },
      documents: { orderBy: { uploadedAt: "desc" } },
      communicationEvents: { orderBy: { happenedAt: "desc" }, take: 20 },
      calendarEvents: {
        where: { status: "active" },
        orderBy: { startAt: "asc" },
      },
      financials: true,
      attributions: { include: { sourceChannel: true } },
    },
  });

  if (!txn) return notFound();

  const contact = txn.contact;
  const tags: string[] = Array.isArray(contact?.tagsJson)
    ? (contact.tagsJson as string[])
    : [];

  const pendingMilestones = txn.milestones.filter((m) => !m.completedAt);
  const completedCount = txn.milestones.length - pendingMilestones.length;

  const risk = new RiskScoringService().compute({ transaction: txn });
  const health = riskHealth(risk.score);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-6 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-900">
          ← Home
        </Link>
        <span className="mx-2 text-neutral-300">·</span>
        <Link href="/transactions" className="hover:text-neutral-900">
          Transactions
        </Link>
      </nav>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={statusBadge(txn.status)}>{txn.status}</span>
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              {txn.transactionType}
            </span>
            {txn.stageName && (
              <span className="text-xs text-neutral-500">
                · FUB: {txn.stageName}
              </span>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {contact.fullName}
          </h1>
          <p className="mt-0.5 text-sm text-neutral-600">
            {txn.propertyAddress ?? "No property address yet"}
            {(txn.city || txn.state) && (
              <>
                {" · "}
                {[txn.city, txn.state, txn.zip].filter(Boolean).join(" ")}
              </>
            )}
          </p>
        </div>
        {txn.milestones.length > 0 && <CalendarSyncButton transactionId={txn.id} />}
      </header>

      {/* Facts grid */}
      <section className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <Fact label="Contact email" value={contact.primaryEmail ?? "—"} />
        <Fact label="Contact phone" value={contact.primaryPhone ?? "—"} />
        <Fact label="Source" value={contact.sourceName ?? "—"} />
        <Fact label="Assigned agent" value={contact.assignedAgentName ?? "—"} />
        <Fact label="Contract date" value={fmtDate(txn.contractDate)} />
        <Fact label="Closing date" value={fmtDate(txn.closingDate)} />
        <Fact label="Inspection" value={fmtDate(txn.inspectionDate)} />
        <Fact label="Appraisal" value={fmtDate(txn.appraisalDate)} />
        <Fact label="Lender" value={txn.lenderName ?? "—"} />
        <Fact label="Title co." value={txn.titleCompanyName ?? "—"} />
        <Fact label="Sale price" value={fmtMoney(txn.financials?.salePrice)} />
        <Fact
          label="Gross commission"
          value={fmtMoney(txn.financials?.grossCommission)}
        />
      </section>

      <AISummaryPanel
        transactionId={txn.id}
        initialSummary={txn.aiSummary}
        initialUpdatedAt={txn.aiSummaryUpdatedAt?.toISOString() ?? null}
      />

      {/* Risk */}
      <section className="mt-6">
        <div
          className={`rounded-lg border p-4 ${riskHealthTone(health)}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide opacity-70">
                Risk · {health}
              </div>
              <div className="mt-0.5 text-2xl font-semibold">
                {risk.score}
                <span className="text-sm font-normal opacity-60">/100</span>
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="font-medium">{risk.recommendation}</div>
            </div>
          </div>
          {risk.factors.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {risk.factors.map((f, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span>{f.description}</span>
                  <span className="shrink-0 opacity-70">+{f.impact}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ForwardingPanel
        transactionId={txn.id}
        initialEmail={txn.forwardingEmail}
        initialProvider={txn.forwardingEmailProvider}
        initialLastRunAt={txn.forwardingLastRunAt?.toISOString() ?? null}
        smartFolderReady={!!txn.smartFolderFilterId}
      />

      <ContractUploadPanel
        transactionId={txn.id}
        initialExtraction={
          (txn.pendingContractJson as unknown as
            | Record<string, unknown>
            | null) ?? null
        }
      />

      <SmartFolderSection
        transactionId={txn.id}
        createdAt={txn.createdAt.toISOString()}
        labelName={txn.propertyAddress ? `REOS/Transactions/${txn.propertyAddress.replace(/\//g, "—").trim().slice(0, 150)}` : null}
        filterId={txn.smartFolderFilterId}
        setupAt={txn.smartFolderSetupAt?.toISOString() ?? null}
        backfillCount={txn.smartFolderBackfillCount}
        eligible={
          txn.createdAt >= SMART_FOLDER_CUTOFF &&
          !!txn.propertyAddress &&
          !txn.smartFolderFilterId
        }
        eligibilityReason={
          txn.createdAt < SMART_FOLDER_CUTOFF
            ? "before_cutoff"
            : !txn.propertyAddress
              ? "no_property_address"
              : null
        }
      />

      <FinancialsForm
        transactionId={txn.id}
        initial={
          txn.financials
            ? {
                salePrice: txn.financials.salePrice,
                grossCommission: txn.financials.grossCommission,
                referralFeeAmount: txn.financials.referralFeeAmount,
                brokerageSplitAmount: txn.financials.brokerageSplitAmount,
                marketingCostAllocated: txn.financials.marketingCostAllocated,
                netCommission: txn.financials.netCommission,
              }
            : null
        }
      />

      {/* Tags */}
      {tags.length > 0 && (
        <section className="mt-6">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            FUB tags
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
              >
                {t}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Milestones */}
      <section className="mt-8">
        <div className="mb-2 flex items-end justify-between">
          <h2 className="text-lg font-medium">Milestones</h2>
          <span className="text-xs text-neutral-500">
            {completedCount} complete · {pendingMilestones.length} pending
          </span>
        </div>
        {txn.milestones.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No milestones yet. Apply a template by setting a contract date.
          </p>
        ) : (
          <ul className="space-y-2">
            {txn.milestones.map((m) => {
              const overdue = !m.completedAt && m.dueAt <= new Date();
              return (
                <li
                  key={m.id}
                  className={`rounded-md border p-3 ${msStatusTone(m)}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>{m.label}</span>
                        {m.completedAt ? (
                          <span className="text-xs font-normal text-emerald-700">
                            ✓ completed {fmtDate(m.completedAt)}
                          </span>
                        ) : overdue ? (
                          <span className="text-xs font-normal text-red-700">
                            overdue
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-500">
                        Owner: {m.ownerRole} · Source: {m.source}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div>{fmtDate(m.dueAt)}</div>
                      <div className="text-xs text-neutral-500">
                        {fmtRel(m.dueAt)}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Tasks */}
      {txn.tasks.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">Tasks</h2>
          <ul className="space-y-2">
            {txn.tasks.map((t) => (
              <li
                key={t.id}
                className="rounded-md border border-neutral-200 bg-white p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    {t.description && (
                      <div className="mt-0.5 text-xs text-neutral-600">
                        {t.description}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {t.completedAt ? "✓ done" : fmtDate(t.dueAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Communication events */}
      {txn.communicationEvents.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">Recent communication</h2>
          <ul className="space-y-2">
            {txn.communicationEvents.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-neutral-200 bg-white p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">
                        {c.type}
                      </span>
                      <span className="text-xs text-neutral-500">
                        · {c.source}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-medium">
                      {c.subject ?? "(no subject)"}
                    </div>
                    {c.summary && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-neutral-600">
                        {c.summary}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-neutral-500">
                    {fmtDate(c.happenedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Calendar events */}
      {txn.calendarEvents.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">
            Calendar events ({txn.calendarEvents.length})
          </h2>
          <ul className="space-y-1 text-sm">
            {txn.calendarEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2"
              >
                <span className="truncate">{e.title}</span>
                <span className="ml-3 shrink-0 text-xs text-neutral-500">
                  {fmtDate(e.startAt)} · {e.calendarType}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Documents */}
      {txn.documents.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">Documents</h2>
          <ul className="space-y-1 text-sm">
            {txn.documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2"
              >
                <span className="truncate">{d.fileName}</span>
                <span className="ml-3 shrink-0 text-xs text-neutral-500">
                  {d.category ?? "—"} · {fmtDate(d.uploadedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Footer */}
      <footer className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        Transaction {txn.id} · Created {fmtDate(txn.createdAt)} · Last synced{" "}
        {fmtDate(txn.lastSyncedAt)}
      </footer>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-neutral-900">{value}</div>
    </div>
  );
}
