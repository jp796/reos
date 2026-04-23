import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CalendarSyncButton } from "../CalendarSyncButton";
import { FinancialsForm } from "./FinancialsForm";
import { AISummaryPanel } from "./AISummaryPanel";
import { SmartFolderSection } from "./SmartFolderSection";
import { ContractUploadPanel } from "./ContractUploadPanel";
import { ForwardingPanel } from "./ForwardingPanel";
import { TransactionTimeline } from "./TransactionTimeline";
import { SharePanel } from "./SharePanel";
import { EditableHeader } from "./EditableHeader";
import { ParticipantsPanel } from "./ParticipantsPanel";
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
    active: "bg-brand-50 text-brand-700 ring-brand-200",
    pending: "bg-accent-100 text-accent-600 ring-accent-200",
    closed: "bg-surface-2 text-text-muted ring-border",
    dead: "bg-red-50 text-danger ring-red-200",
  };
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${map[status] ?? "bg-surface-2 text-text-muted ring-border"}`;
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
      participants: {
        orderBy: { createdAt: "asc" },
        include: {
          contact: {
            select: {
              id: true,
              fullName: true,
              primaryEmail: true,
              primaryPhone: true,
            },
          },
        },
      },
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
    <main className="mx-auto max-w-6xl">
      <nav className="mb-5 text-sm text-text-muted">
        <Link href="/transactions" className="hover:text-text">
          Transactions
        </Link>
        <span className="mx-2 text-text-subtle">/</span>
        <span className="text-text">{contact.fullName}</span>
      </nav>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <EditableHeader
          transactionId={txn.id}
          status={txn.status}
          transactionType={txn.transactionType}
          stageName={txn.stageName}
          contactName={contact.fullName}
          propertyAddress={txn.propertyAddress}
          city={txn.city}
          state={txn.state}
          zip={txn.zip}
          side={txn.side}
        />
        {txn.milestones.length > 0 && (
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

      <ParticipantsPanel
        transactionId={txn.id}
        primaryContactName={contact.fullName}
        primarySide={txn.side}
        initial={txn.participants.map((p) => ({
          id: p.id,
          role: p.role,
          notes: p.notes,
          createdAt: p.createdAt.toISOString(),
          contact: p.contact,
        }))}
      />

      <AISummaryPanel
        transactionId={txn.id}
        initialSummary={txn.aiSummary}
        initialUpdatedAt={txn.aiSummaryUpdatedAt?.toISOString() ?? null}
      />

      {/* Risk */}
      <section className="mt-6">
        <div
          className={`rounded-md border p-4 ${riskHealthTone(health)}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="reos-label opacity-80">
                Risk · {health}
              </div>
              <div className="mt-1 font-display text-display-md font-semibold">
                {risk.score}
                <span className="ml-1 font-sans text-sm font-normal opacity-60">
                  / 100
                </span>
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
                  <span className="shrink-0 opacity-70 tabular-nums">
                    +{f.impact}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <SharePanel
        transactionId={txn.id}
        initialToken={txn.shareToken}
        initialExpiresAt={txn.shareExpiresAt?.toISOString() ?? null}
      />

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
        side={txn.side}
        initial={
          txn.financials
            ? {
                salePrice: txn.financials.salePrice,
                commissionPercent: txn.financials.commissionPercent,
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

      {/* Timeline (visual milestones) */}
      <TransactionTimeline
        transactionId={txn.id}
        initialMilestones={txn.milestones.map((m) => ({
          id: m.id,
          type: m.type,
          label: m.label,
          dueAt: m.dueAt.toISOString(),
          completedAt: m.completedAt?.toISOString() ?? null,
          status: m.status,
          ownerRole: m.ownerRole,
          source: m.source,
        }))}
        effectiveDate={txn.contractDate?.toISOString() ?? null}
        closingDate={txn.closingDate?.toISOString() ?? null}
      />

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
      <footer className="mt-10 border-t border-border pt-4 text-xs text-text-subtle">
        Transaction {txn.id} · Created {fmtDate(txn.createdAt)} · Last synced{" "}
        {fmtDate(txn.lastSyncedAt)}
      </footer>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="reos-label">{label}</div>
      <div className="mt-1 text-sm text-text">{value}</div>
    </div>
  );
}
