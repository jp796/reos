import Link from "next/link";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { CalendarSyncButton } from "../CalendarSyncButton";
import { FinancialsForm } from "./FinancialsForm";
import { AISummaryPanel } from "./AISummaryPanel";
import { SmartFolderSection } from "./SmartFolderSection";
import { ContractUploadPanel } from "./ContractUploadPanel";
import { ForwardingPanel } from "./ForwardingPanel";
import { TransactionTimeline } from "./TransactionTimeline";
import { SharePanel } from "./SharePanel";
import { EditableHeader } from "./EditableHeader";
import { DeleteTransactionButton } from "./DeleteTransactionButton";
import { InspectionsPanel } from "./InspectionsPanel";
import { NotesPanel } from "./NotesPanel";
import { EditablePrimaryContact } from "./EditablePrimaryContact";
import { TaskPanel } from "./TaskPanel";
import { CompliancePanel } from "./CompliancePanel";
import { MissingItemsAlert } from "./MissingItemsAlert";
import { auditTransactionCompliance } from "@/services/core/ComplianceChecklist";
import { CdaButton } from "./CdaButton";
import { SendPanel } from "./SendPanel";
import { WireVerificationPanel } from "./WireVerificationPanel";
import { ContractVersionHistory } from "./ContractVersionHistory";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { PartiesQuickEdit } from "./PartiesQuickEdit";
import { ProductionToggle } from "./ProductionToggle";
import { RezenCompliancePrepPanel } from "./RezenCompliancePrepPanel";
import { ConvertListingButton } from "./ConvertListingButton";
import { SocialPostsPanel } from "./SocialPostsPanel";
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
  dueAt: Date | null;
  completedAt: Date | null;
}) {
  if (ms.completedAt) return "border-emerald-200 bg-emerald-50";
  const overdue = ms.status === "pending" && ms.dueAt && ms.dueAt <= new Date();
  if (overdue) return "border-red-200 bg-red-50";
  return "border-border bg-surface";
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Need the active user for the NotesPanel (track read state per
  // user). requireSession also enforces tenancy — if the txn belongs
  // to another account this guards before the data fetch.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return notFound();

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
      inspections: { orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }] },
    },
  });

  if (!txn) return notFound();

  const contact = txn.contact;

  // Is this primary contact referenced on any OTHER transaction?
  // Drives the "renaming propagates" warning in <EditablePrimaryContact>.
  const otherUses = await prisma.transaction.count({
    where: { contactId: contact.id, NOT: { id: txn.id } },
  });

  // Team members for the AssigneePicker. Scoped to this account.
  const team = await prisma.user.findMany({
    where: { accountId: txn.accountId },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  // Brokerage-level toggles. Compliance audit hides when the brokerage
  // already has its own audit (Rezen, Skyslope, etc.) so we don't
  // duplicate the file-completeness signal.
  const account = await prisma.account.findUnique({
    where: { id: txn.accountId },
    select: {
      settingsJson: true,
      // Multi-tenant compliance: each account is linked to a brokerage
      // profile that declares which compliance system its TCs use.
      // The Rezen-specific UI (file naming, submission ZIP bundle)
      // only renders when complianceSystem === "rezen". Brokerages on
      // Skyslope / Dotloop / Lone Wolf / in-house get the generic
      // CompliancePanel + missing-items alert, but not the Rezen prep
      // flow they don't need.
      brokerageProfile: {
        select: { complianceSystem: true },
      },
    },
  });
  const accountSettings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const complianceAuditEnabled = accountSettings.complianceAuditEnabled !== false;
  const complianceSystem = account?.brokerageProfile?.complianceSystem ?? null;
  const isRezenShop = complianceSystem === "rezen";

  // Run the file audit server-side so MissingItemsAlert renders
  // synchronously with the page (no spinner, no flicker). Skip when
  // disabled — saves the Document scan for brokerages running their
  // own audit outside REOS.
  const complianceAudit = complianceAuditEnabled
    ? await auditTransactionCompliance(prisma, txn.id)
    : { items: [], missing: 0, present: 0, total: 0 };
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
        <div className="min-w-0 flex-1">
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
            assignedUserId={txn.assignedUserId}
            team={team.map((t) => ({
              id: t.id,
              name: t.name,
              email: t.email,
              role: t.role,
            }))}
          />
          <EditablePrimaryContact
            contactId={contact.id}
            fullName={contact.fullName}
            primaryEmail={contact.primaryEmail}
            primaryPhone={contact.primaryPhone}
            referencedElsewhere={otherUses > 0}
            side={txn.side}
            propertyAddress={txn.propertyAddress}
            buyerNames={[
              ...(txn.side === "buy" || txn.side === "both"
                ? [contact.fullName]
                : []),
              ...txn.participants
                .filter((p) => p.role === "co_buyer")
                .map((p) => p.contact.fullName),
            ]}
            sellerNames={[
              ...(txn.side === "sell" ? [contact.fullName] : []),
              ...txn.participants
                .filter((p) => p.role === "co_seller")
                .map((p) => p.contact.fullName),
            ]}
            salePrice={txn.financials?.salePrice ?? null}
            commissionPercent={txn.financials?.commissionPercent ?? null}
            grossCommission={txn.financials?.grossCommission ?? null}
            contractDate={txn.contractDate}
            closingDate={txn.closingDate}
          />
          {txn.status === "listing" && (
            <ConvertListingButton transactionId={txn.id} />
          )}
          <PartiesQuickEdit
            transactionId={txn.id}
            primaryContact={{
              id: contact.id,
              fullName: contact.fullName,
              primaryEmail: contact.primaryEmail,
              primaryPhone: contact.primaryPhone,
            }}
            side={txn.side}
            participants={txn.participants.map((p) => ({
              id: p.id,
              role: p.role,
              contact: {
                id: p.contact.id,
                fullName: p.contact.fullName,
                primaryEmail: p.contact.primaryEmail,
                primaryPhone: p.contact.primaryPhone,
              },
            }))}
          />
        </div>
        <div className="flex items-center gap-2">
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
          <DeleteTransactionButton
            transactionId={txn.id}
            propertyAddress={txn.propertyAddress}
          />
        </div>
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
        <Fact
          label="Inspection objection"
          value={fmtDate(txn.inspectionObjectionDate)}
        />
        <Fact label="Title commitment" value={fmtDate(txn.titleDeadline)} />
        <Fact
          label="Title objection"
          value={fmtDate(txn.titleObjectionDate)}
        />
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
        primaryContact={{
          id: contact.id,
          fullName: contact.fullName,
          primaryEmail: contact.primaryEmail,
          primaryPhone: contact.primaryPhone,
        }}
        primarySide={txn.side}
        initial={txn.participants.map((p) => ({
          id: p.id,
          role: p.role,
          notes: p.notes,
          createdAt: p.createdAt.toISOString(),
          contact: p.contact,
        }))}
      />

      {/* Compliance alert — one-glance status surfaced above the AI
          summary so TCs see "3 items missing" before they read prose.
          Full per-row audit lives in CompliancePanel further down
          (anchor: #compliance-audit). Gated by the same brokerage
          opt-out flag so a brokerage running its own audit isn't
          double-nagged. */}
      {complianceAuditEnabled && (
        <MissingItemsAlert
          missing={complianceAudit.missing}
          total={complianceAudit.total}
          topMissing={complianceAudit.items
            .filter((i) => i.status === "missing")
            .slice(0, 3)
            .map((i) => ({
              key: i.requirement.key,
              label: i.requirement.label,
              stage: i.requirement.stage,
            }))}
        />
      )}

      <AISummaryPanel
        transactionId={txn.id}
        initialSummary={txn.aiSummary}
        initialUpdatedAt={txn.aiSummaryUpdatedAt?.toISOString() ?? null}
      />

      <NotesPanel transactionId={txn.id} currentUserId={actor.userId} />

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
        side={txn.side}
        hasSmartFolder={!!txn.smartFolderLabelId}
        initialExtraction={
          (txn.pendingContractJson as unknown as
            | Record<string, unknown>
            | null) ?? null
        }
      />

      {/* Contract version history — shows diffs between snapshots.
          Hides itself when there's no history (zero prior versions). */}
      <ContractVersionHistory transactionId={txn.id} />

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

      <ProductionToggle
        transactionId={txn.id}
        initial={txn.excludeFromProduction}
        closingDateIso={txn.closingDate?.toISOString() ?? null}
        status={txn.status}
      />

      {/* CDA — generate + download the disbursement authorization PDF */}
      <div className="mt-3 flex items-center justify-end gap-2">
        <CdaButton
          transactionId={txn.id}
          enabled={!!txn.financials?.grossCommission}
        />
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <section className="mt-6">
          <h3 className="text-xs uppercase tracking-wide text-text-muted">
            FUB tags
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded bg-surface-2 px-2 py-0.5 text-xs text-text"
              >
                {t}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Timeline (visual milestones) — Inspections panel renders
          INSIDE this section so scheduling appointments lives next
          to the contract deadlines, not in a separate block below. */}
      <TransactionTimeline
        transactionId={txn.id}
        initialMilestones={txn.milestones.map((m) => ({
          id: m.id,
          type: m.type,
          label: m.label,
          dueAt: m.dueAt?.toISOString() ?? null,
          completedAt: m.completedAt?.toISOString() ?? null,
          status: m.status,
          ownerRole: m.ownerRole,
          source: m.source,
        }))}
        effectiveDate={txn.contractDate?.toISOString() ?? null}
        closingDate={txn.closingDate?.toISOString() ?? null}
      >
        <InspectionsPanel
          transactionId={txn.id}
          initial={txn.inspections.map((i) => ({
            id: i.id,
            kind: i.kind,
            label: i.label,
            scheduledAt: i.scheduledAt?.toISOString() ?? null,
            vendorName: i.vendorName,
            vendorNote: i.vendorNote,
            remindOnTelegram: i.remindOnTelegram,
            calendarEventId: i.calendarEventId,
            completedAt: i.completedAt?.toISOString() ?? null,
          }))}
          inspectionDeadline={txn.inspectionDate?.toISOString() ?? null}
          inspectionObjectionDeadline={
            txn.inspectionObjectionDate?.toISOString() ?? null
          }
        />
      </TransactionTimeline>

      {/* Tasks — TC work queue, separate from milestones which track dates */}
      <TaskPanel
        transactionId={txn.id}
        initial={txn.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          dueAt: t.dueAt?.toISOString() ?? null,
          completedAt: t.completedAt?.toISOString() ?? null,
          assignedTo: t.assignedTo,
          priority: t.priority,
          milestoneId: t.milestoneId,
        }))}
      />

      {/* Compliance file audit — required docs per side + state.
          Hidden when the brokerage runs its own audit (Settings → Brokerage).
          The #compliance-audit anchor is the scroll target from
          MissingItemsAlert's "View full audit ↓" link. */}
      {complianceAuditEnabled && (
        <div id="compliance-audit" className="scroll-mt-20">
          <CompliancePanel transactionId={txn.id} />
        </div>
      )}

      {/* Rezen prep — slot-by-slot status + downloadable package
          renamed for Rezen's file UI. Gated to Rezen shops only:
          a Skyslope / Dotloop / Lone Wolf / in-house TC has no need
          for the "01 - " filename prefixing or the Rezen-shaped ZIP
          bundle. They still get the generic per-row CompliancePanel
          above plus the MissingItemsAlert summary near the AI summary.
          Track 2 (later) adds per-system adapters so we can bundle
          for Skyslope/Dotloop/etc. directly. */}
      {isRezenShop && <RezenCompliancePrepPanel transactionId={txn.id} />}

      {/* Social posts — generate ready-to-paste captions for the
          three milestone events (listed/under-contract/sold). */}
      <SocialPostsPanel
        transactionId={txn.id}
        defaultEvent={
          txn.status === "listing"
            ? "new_listing"
            : txn.status === "closed"
              ? "sold"
              : "under_contract"
        }
      />

      {/* Wire fraud verification log — compliance record of the voice
          call confirming wire instructions before the client sends funds. */}
      <WireVerificationPanel
        transactionId={txn.id}
        closingDate={txn.closingDate?.toISOString() ?? null}
        titleCompanyName={txn.titleCompanyName}
      />

      {/* Send email from template — merges transaction data into saved
          templates, sends via the acting user's Gmail. */}
      <SendPanel
        transactionId={txn.id}
        primaryEmail={contact.primaryEmail}
        parties={[
          // Primary contact is addressable by its side
          ...(txn.side === "buy" || txn.side === "both"
            ? [
                {
                  role: "co_buyer",
                  fullName: contact.fullName,
                  email: contact.primaryEmail,
                },
              ]
            : []),
          ...(txn.side === "sell" || txn.side === "both"
            ? [
                {
                  role: "co_seller",
                  fullName: contact.fullName,
                  email: contact.primaryEmail,
                },
              ]
            : []),
          ...txn.participants.map((p) => ({
            role: p.role,
            fullName: p.contact.fullName,
            email: p.contact.primaryEmail,
          })),
        ]}
      />

      {/* Communication events */}
      {txn.communicationEvents.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">Recent communication</h2>
          <ul className="space-y-2">
            {txn.communicationEvents.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-border bg-surface p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-text-muted">
                        {c.type}
                      </span>
                      <span className="text-xs text-text-muted">
                        · {c.source}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-medium">
                      {c.subject ?? "(no subject)"}
                    </div>
                    {c.summary && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-text-muted">
                        {c.summary}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-text-muted">
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
                className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="truncate">{e.title}</span>
                <span className="ml-3 shrink-0 text-xs text-text-muted">
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
                className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="truncate">{d.fileName}</span>
                <span className="ml-3 shrink-0 text-xs text-text-muted">
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
