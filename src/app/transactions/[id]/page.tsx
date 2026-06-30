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
import { DocumentLibraryPanel } from "./DocumentLibraryPanel";
import { DealSynthesisPanel } from "./DealSynthesisPanel";
import type { SynthesisSnapshot } from "@/services/core/DocumentSynthesisService";
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
import { StagePanel } from "./StagePanel";
import { DrawCapitalPanel } from "./DrawCapitalPanel";
import { EconomicsPanel } from "./EconomicsPanel";
import { DealTypeControl } from "./DealTypeControl";
import { readEntitlements } from "@/lib/entitlements";
import { isDealVisible, canToggleRestriction } from "@/lib/deal-visibility";
import { VisibilityToggle } from "./VisibilityToggle";
import {
  getStrategyTemplate,
  hasStageLifecycle,
  hasReachedMarketEntry,
  marketEntryStage,
} from "@/services/core/strategyTemplates";
import type { Strategy } from "@/services/core/DealClassifierService";
import { computeInvestorRisk } from "@/services/core/InvestorRiskService";
import { SocialPostsPanel } from "./SocialPostsPanel";
import { EsignPanel } from "./EsignPanel";
import { SMART_FOLDER_CUTOFF } from "@/services/automation/SmartFolderService";
import {
  RiskScoringService,
  riskHealth,
  riskHealthTone,
} from "@/services/core/RiskScoringService";
import { DealWorkspaceTabs } from "./DealWorkspaceTabs";
import { DealAtlasChat } from "./DealAtlasChat";

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

function strategyLabel(s: string): string {
  const map: Record<string, string> = {
    retail: "Retail",
    flip: "Flip",
    wholesale: "Wholesale",
    rental_brrrr: "Rental / BRRRR",
    creative: "Creative Finance",
  };
  return map[s] ?? s;
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

  // Tenancy enforcement: scope by accountId in the WHERE clause so a
  // user from another tenant gets a clean 404. Without this guard the
  // page renders cross-tenant data, every sub-panel API call then
  // 404s (those routes DO check tenancy), and one of the panels
  // crashes the client. Same class of bug as the Phase 0 leaks —
  // never trust an `id` from the URL alone.
  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    include: {
      contact: true,
      asset: {
        select: {
          id: true,
          strategy: true,
          representation: true,
          titlePath: true,
          currentStageName: true,
          economicsJson: true,
        },
      },
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
      esignRequests: {
        orderBy: { createdAt: "desc" },
        include: {
          document: {
            select: { id: true, fileName: true, mimeType: true, uploadedAt: true },
          },
          recipients: {
            orderBy: { signingOrder: "asc" },
            select: { name: true, email: true, status: true, signedAt: true },
          },
        },
      },
    },
  });

  if (!txn) return notFound();

  // Per-deal privacy: a restricted deal is a clean 404 for anyone who
  // isn't the assignee or an owner/admin — same shape as a cross-tenant
  // miss, so its existence isn't even confirmable.
  if (!isDealVisible(actor, txn)) return notFound();

  const contact = txn.contact;
  const signerOptions = [
    ...txn.participants
      .map((p) => ({
        name: p.contact.fullName,
        email: p.contact.primaryEmail ?? "",
        role: p.role,
      }))
      .filter((p) => p.email),
    {
      name: contact.fullName,
      email: contact.primaryEmail ?? "",
      role: "primary",
    },
  ]
    .filter((p) => p.email)
    .filter(
      (p, index, arr) =>
        arr.findIndex((x) => x.email.toLowerCase() === p.email.toLowerCase()) ===
        index,
    );

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
      realApiTokensEncrypted: true,
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

  // Investor entitlement gates the Deal-type control (the front door to
  // the investor PM surfaces).
  const investorEntitled = (await readEntitlements(actor.accountId)).includes(
    "investor",
  );

  // Gmail deferral (JP's workflow): an investor deal stays Gmail-quiet
  // through acquisition + rehab and only activates the SmartFolder at its
  // market-entry stage. Retail deals are never deferred.
  const isPrincipalDeal = txn.asset?.representation === "principal";
  const gmailDeferred =
    isPrincipalDeal &&
    !hasReachedMarketEntry(
      txn.asset!.strategy as Strategy,
      txn.asset!.currentStageName,
    );
  const marketEntryName = isPrincipalDeal
    ? (marketEntryStage(txn.asset!.strategy as Strategy)?.name ?? null)
    : null;

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
  const openTaskCount = txn.tasks.filter((t) => !t.completedAt).length;

  const risk = new RiskScoringService().compute({ transaction: txn });
  const health = riskHealth(risk.score);

  // Investor risk (spec §10) — computed for principal deals from stored
  // draw + capital data. Cheap: two aggregates + one row.
  let investorRisk: ReturnType<typeof computeInvestorRisk> | null = null;
  if (txn.asset && txn.asset.representation === "principal") {
    const [drawAgg, nearestBalloon, sched] = await Promise.all([
      prisma.draw.aggregate({
        where: { assetId: txn.asset.id },
        _sum: { amount: true },
      }),
      prisma.capitalStackEntry.findFirst({
        where: { assetId: txn.asset.id, balloonDate: { not: null } },
        select: { balloonDate: true },
        orderBy: { balloonDate: "asc" },
      }),
      prisma.drawSchedule.findFirst({
        where: { assetId: txn.asset.id, status: "active" },
        select: { totalBudget: true },
      }),
    ]);
    const daysHeld = txn.contractDate
      ? Math.floor((Date.now() - txn.contractDate.getTime()) / 86_400_000)
      : null;
    const balloonHorizonDays = nearestBalloon?.balloonDate
      ? Math.floor(
          (nearestBalloon.balloonDate.getTime() - Date.now()) / 86_400_000,
        )
      : null;
    const r = computeInvestorRisk({
      strategy: txn.asset.strategy as Strategy,
      titlePath: txn.asset.titlePath,
      rehabBudget: sched?.totalBudget ?? null,
      rehabSpent: drawAgg._sum.amount ?? null,
      daysHeld,
      balloonHorizonDays,
      exitFunded: false,
    });
    if (r.factors.length > 0) investorRisk = r;
  }

  // ── Tab content (grouped from the former long scroll) ──────────────
  const timelineTab = (
    <div className="space-y-6">
      <DealSynthesisPanel
        transactionId={txn.id}
        snapshot={(txn.synthesisJson as unknown as SynthesisSnapshot) ?? null}
        synthesizedAt={txn.synthesizedAt?.toISOString() ?? null}
      />
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

      {txn.asset && hasStageLifecycle(txn.asset.strategy as Strategy) && (
        <StagePanel
          assetId={txn.asset.id}
          strategyLabel={strategyLabel(txn.asset.strategy)}
          stages={getStrategyTemplate(txn.asset.strategy as Strategy).map(
            (s) => ({ key: s.key, name: s.name }),
          )}
          currentStageKey={txn.asset.currentStageName}
        />
      )}

      {txn.calendarEvents.length > 0 && (
        <section>
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
    </div>
  );

  const tasksTab = (
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
  );

  const detailsTab = (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
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
        <Fact label="Title objection" value={fmtDate(txn.titleObjectionDate)} />
        <Fact label="Appraisal" value={fmtDate(txn.appraisalDate)} />
        <Fact label="Lender" value={txn.lenderName ?? "—"} />
        <Fact label="Title co." value={txn.titleCompanyName ?? "—"} />
        <Fact label="Sale price" value={fmtMoney(txn.financials?.salePrice)} />
        <Fact
          label="Commission %"
          value={
            txn.financials?.commissionPercent != null
              ? `${txn.financials.commissionPercent}%`
              : "—"
          }
        />
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

      <section>
        <div className={`rounded-md border p-4 ${riskHealthTone(health)}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="reos-label opacity-80">Risk · {health}</div>
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

      {investorRisk && (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="flex items-center justify-between">
            <div className="reos-label text-amber-800 dark:text-amber-200">
              Investor risk
            </div>
            <div className="font-display text-display-md font-semibold text-amber-800 dark:text-amber-200">
              {investorRisk.score}
              <span className="ml-1 font-sans text-sm font-normal opacity-60">/ 100</span>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-amber-900 dark:text-amber-100">
            {investorRisk.factors.map((x, i) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <span>{x.description}</span>
                <span className="shrink-0 tabular-nums opacity-70">+{x.impact}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      <div className="flex items-center justify-end gap-2">
        <CdaButton
          transactionId={txn.id}
          enabled={!!txn.financials?.grossCommission}
        />
      </div>

      {txn.asset && txn.asset.representation === "principal" && (
        <EconomicsPanel
          assetId={txn.asset.id}
          strategy={txn.asset.strategy as Strategy}
          initial={
            (txn.asset.economicsJson as Record<string, unknown> | null) ?? null
          }
        />
      )}

      {txn.asset && txn.asset.representation === "principal" && (
        <DrawCapitalPanel assetId={txn.asset.id} />
      )}

      {tags.length > 0 && (
        <section>
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
    </div>
  );

  const complianceTab = (
    <div className="space-y-6">
      {complianceAuditEnabled && (
        <div id="compliance-audit" className="scroll-mt-20">
          <CompliancePanel
            transactionId={txn.id}
            appliedName={txn.complianceTemplateName}
          />
        </div>
      )}
      {isRezenShop && (
        <RezenCompliancePrepPanel
          transactionId={txn.id}
          rezenTransactionId={txn.rezenTransactionId}
          rezenConnected={!!account?.realApiTokensEncrypted}
        />
      )}
      <WireVerificationPanel
        transactionId={txn.id}
        closingDate={txn.closingDate?.toISOString() ?? null}
        titleCompanyName={txn.titleCompanyName}
      />
    </div>
  );

  const filesTab = (
    <div className="space-y-6">
      <DocumentLibraryPanel
        transactionId={txn.id}
        documents={txn.documents.map((d) => {
          const reqs = txn.esignRequests.filter((r) => r.document?.id === d.id);
          let esignStatus: "none" | "draft" | "sent" | "completed" | "voided" | "error" = "none";
          let esignSummary: string | null = null;
          if (reqs.length > 0) {
            const newest = reqs[0];
            esignStatus =
              (newest.status as "none" | "draft" | "sent" | "completed" | "voided" | "error") ?? "none";
            if (newest.status === "completed") {
              esignSummary = "✓ Completed";
            } else if (newest.status === "sent") {
              esignSummary = `Sent · awaiting signatures`;
            } else if (newest.status === "voided") {
              esignSummary = "Voided";
            } else if (newest.status === "error") {
              esignSummary = "Send failed";
            } else if (newest.status === "draft") {
              esignSummary = "Draft saved";
            }
          }
          return {
            id: d.id,
            fileName: d.fileName,
            mimeType: d.mimeType,
            category: d.category,
            source: d.source,
            uploadOrigin: d.uploadOrigin,
            uploadedAt: d.uploadedAt.toISOString(),
            suggestedRezenSlot: d.suggestedRezenSlot,
            suggestedRezenConfidence: d.suggestedRezenConfidence,
            classifiedAt: d.classifiedAt?.toISOString() ?? null,
            hasRawBytes: d.rawBytes !== null && d.rawBytes !== undefined,
            hasExtractedText:
              d.extractedText !== null &&
              d.extractedText !== undefined &&
              d.extractedText.length > 0,
            esignStatus,
            esignSummary,
          };
        })}
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

      <ContractVersionHistory transactionId={txn.id} />

      <EsignPanel
        transactionId={txn.id}
        documents={txn.documents.map((d) => ({
          id: d.id,
          fileName: d.fileName,
          mimeType: d.mimeType,
        }))}
        signerOptions={signerOptions}
        requests={txn.esignRequests.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          signingLinksJson: r.signingLinksJson,
          errorMessage: r.errorMessage,
          createdAt: r.createdAt,
          sentAt: r.sentAt,
          recipients: r.recipients,
        }))}
      />
    </div>
  );

  const emailTab = (
    <div className="space-y-6">
      <SendPanel
        transactionId={txn.id}
        primaryEmail={contact.primaryEmail}
        parties={[
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

      <ForwardingPanel
        transactionId={txn.id}
        initialEmail={txn.forwardingEmail}
        initialProvider={txn.forwardingEmailProvider}
        initialLastRunAt={txn.forwardingLastRunAt?.toISOString() ?? null}
        smartFolderReady={!!txn.smartFolderFilterId}
      />

      <SmartFolderSection
        transactionId={txn.id}
        createdAt={txn.createdAt.toISOString()}
        labelName={txn.propertyAddress ? `REOS/Transactions/${txn.propertyAddress.replace(/\//g, "—").trim().slice(0, 150)}` : null}
        filterId={txn.smartFolderFilterId}
        setupAt={txn.smartFolderSetupAt?.toISOString() ?? null}
        backfillCount={txn.smartFolderBackfillCount}
        eligible={
          !gmailDeferred &&
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
        gmailDeferred={gmailDeferred}
        marketEntryStageName={marketEntryName}
      />

      <SharePanel
        transactionId={txn.id}
        initialToken={txn.shareToken}
        initialExpiresAt={txn.shareExpiresAt?.toISOString() ?? null}
      />

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

      {txn.communicationEvents.length > 0 && (
        <section>
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
                      <span className="text-xs text-text-muted">· {c.source}</span>
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
    </div>
  );

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
            inspectionDeadline={txn.inspectionDate ?? null}
            inspectionObjectionDeadline={txn.inspectionObjectionDate ?? null}
            rezenConnected={!!account?.realApiTokensEncrypted}
          />
          {txn.status === "listing" && (
            <ConvertListingButton transactionId={txn.id} />
          )}
          {investorEntitled && txn.asset && (
            <DealTypeControl
              assetId={txn.asset.id}
              strategy={txn.asset.strategy}
            />
          )}
          {canToggleRestriction(actor.role) && (
            <VisibilityToggle
              transactionId={txn.id}
              initialRestricted={txn.restrictedToAssignee}
              assigneeName={
                team.find((t) => t.id === txn.assignedUserId)?.name ?? null
              }
            />
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
          <Link
            href={`/transactions/${txn.id}/summary`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-muted hover:border-brand-500 hover:text-brand-700"
          >
            Summary
          </Link>
          <DeleteTransactionButton
            transactionId={txn.id}
            propertyAddress={txn.propertyAddress}
          />
        </div>
      </header>

      {/* Persistent at-a-glance: compliance alert + AI brief + notes */}
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

      {/* Tabbed workspace */}
      <DealWorkspaceTabs
        tabs={[
          { id: "timeline", label: "Timeline", content: timelineTab },
          { id: "tasks", label: "Tasks", badge: openTaskCount, content: tasksTab },
          { id: "details", label: "Details", content: detailsTab },
          {
            id: "compliance",
            label: "Compliance",
            badge: complianceAuditEnabled ? complianceAudit.missing : null,
            content: complianceTab,
          },
          { id: "files", label: "Files", badge: txn.documents.length, content: filesTab },
          { id: "email", label: "Email", content: emailTab },
        ]}
      />

      {/* Footer */}
      <footer className="mt-10 border-t border-border pt-4 text-xs text-text-subtle">
        Transaction {txn.id} · Created {fmtDate(txn.createdAt)} · Last synced{" "}
        {fmtDate(txn.lastSyncedAt)}
      </footer>

      {/* In-app Atlas chat — dockable, deal-scoped */}
      <DealAtlasChat
        transactionId={txn.id}
        dealLabel={txn.propertyAddress || contact.fullName}
      />
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
