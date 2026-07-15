/**
 * POST /api/automation/create-from-scan
 *
 * Called from the "Scan for accepted contracts" panel AND from the
 * manual upload-contract flow. Creates a contact (if not found),
 * then a transaction populated with EVERY extraction field the
 * caller passes through — dates, commission, parties, title co,
 * lender. Seeds milestones per date. Upserts TransactionFinancials
 * from price + commission. Auto-creates SmartFolder.
 *
 * Invariant: every field the extractor returned makes it to the DB.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import { requireSession } from "@/lib/require-session";
import {
  addBusinessDays,
  defaultWalkthroughForState,
} from "@/lib/business-days";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import { SmartFolderService } from "@/services/automation/SmartFolderService";
import { classifyDeal } from "@/services/core/DealClassifierService";
import { applyStrategyTemplate } from "@/services/core/StageEngine";
import { hasStageLifecycle } from "@/services/core/strategyTemplates";
import { logWorkflowEvent } from "@/lib/instrumentation";

export const runtime = "nodejs";
export const maxDuration = 90;

function toDate(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = parseFloat(v.replace(/[,$\s%]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Resolve which side WE represent from the contract's brokerage block.
 *
 * JP's rule: the footer "Prepared by" agent is the buyer's agent, so the
 * extraction tags the buyer's firm side="buyer" and the listing firm
 * side="listing". Whichever side OUR brokerage sits on is the side we
 * represent — that, not "is a buyer named", is the reliable signal.
 *
 * Returns "buy" | "sell" only on a confident name match; null otherwise
 * (caller then falls back to the weaker name-presence inference).
 */
function resolveFirmSideFromBrokerages(
  brokerages: Array<{ name?: string | null; side?: string | null }> | null | undefined,
  ourName: string | null | undefined,
): "buy" | "sell" | null {
  if (!brokerages?.length || !ourName?.trim()) return null;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(llc|inc|l\.?l\.?c|co|company|realty|group|brokerage|real estate)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const target = norm(ourName);
  if (!target) return null;
  const targetTokens = target.split(" ").filter((t) => t.length > 2);
  for (const b of brokerages) {
    const name = b.name?.trim();
    const side = b.side?.trim().toLowerCase();
    if (!name || (side !== "buyer" && side !== "listing")) continue;
    const cand = norm(name);
    if (!cand) continue;
    const hit =
      cand === target ||
      cand.includes(target) ||
      target.includes(cand) ||
      (targetTokens.length > 0 && targetTokens.every((t) => cand.includes(t)));
    if (hit) return side === "listing" ? "sell" : "buy";
  }
  return null;
}

/** §4b — trust only the shape we render (never persist arbitrary client JSON).
 *  Keeps {key,label,original,superseding} with scalar-only side fields. */
function sanitizeConflicts(
  raw: Array<Record<string, unknown>> | null | undefined,
): Prisma.InputJsonValue | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const side = (v: unknown) => {
    const o = (v ?? {}) as Record<string, unknown>;
    return {
      value: o.value ?? null,
      snippet: typeof o.snippet === "string" ? o.snippet.slice(0, 300) : null,
      page: typeof o.page === "number" ? o.page : null,
      confidence: typeof o.confidence === "number" ? o.confidence : null,
      effectiveDate: typeof o.effectiveDate === "string" ? o.effectiveDate : null,
    };
  };
  const out = raw
    .filter((c) => c && typeof c === "object" && typeof c.key === "string")
    .slice(0, 20)
    .map((c) => ({
      key: String(c.key).slice(0, 60),
      label: typeof c.label === "string" ? c.label.slice(0, 60) : String(c.key),
      original: side(c.original),
      superseding: side(c.superseding),
    }));
  return out.length > 0 ? (out as unknown as Prisma.InputJsonValue) : null;
}

interface Body {
  address?: string;
  /** Which side the user represents ("buy" | "sell"); from the wizard
   *  side-picker. When given it wins over inference. */
  side?: string | null;
  /** The side WE represent, expressed as the contract's firm side
   *  ("buyer" | "listing"), when a caller has already matched our
   *  brokerage. Beats name-presence inference; loses to explicit `side`
   *  and to a server-side brokerage match. */
  firmSide?: string | null;
  /** Every brokerage the extraction named, with the side it represents
   *  (footer-derived: the "Prepared by" firm on the buyer-broker line is
   *  side="buyer"). The server finds OUR firm in this list to learn the
   *  side we actually represent (see resolveFirmSideFromBrokerages). */
  brokerages?: Array<{ name?: string | null; side?: string | null }> | null;
  buyerName?: string | null;
  sellerName?: string | null;
  effectiveDate?: string | null;
  closingDate?: string | null;
  possessionDate?: string | null;
  inspectionDeadline?: string | null;
  inspectionObjectionDeadline?: string | null;
  titleCommitmentDeadline?: string | null;
  titleObjectionDeadline?: string | null;
  financingDeadline?: string | null;
  walkthroughDate?: string | null;
  earnestMoneyDueDate?: string | null;
  earnestMoneyAmount?: number | null;
  purchasePrice?: number | null;
  sellerSideCommissionPct?: number | null;
  sellerSideCommissionAmount?: number | null;
  buyerSideCommissionPct?: number | null;
  buyerSideCommissionAmount?: number | null;
  titleCompany?: string | null;
  lenderName?: string | null;
  contractStage?: string | null;
  /** §4b — addendum reconciliations (a later doc changed these terms). */
  conflicts?: Array<Record<string, unknown>> | null;
  threadId?: string | null;
  // ── Investor-module signals (spec §5). Optional — the retail Gmail
  // scan never sends these, so a scanned contract classifies as
  // retail/agency. Richer intake paths (voice, manual investor entry)
  // pass them to drive flip / wholesale / BRRRR / creative detection. ──
  contractText?: string | null;
  rehabBudget?: boolean | null;
  resaleIntent?: boolean | null;
  rentEstimate?: boolean | null;
  refinanceIntent?: boolean | null;
  assignmentClause?: boolean | null;
  cashBuyerDisposition?: boolean | null;
  twoClosingIntent?: boolean | null;
}

export async function POST(req: NextRequest) {
  // Tenancy guard. Prior implementation used
  // `prisma.account.findFirst()` which returns AN account — whichever
  // row Postgres feels like handing back — and stamped every contact +
  // transaction with that id. That meant every customer's contract
  // uploads landed in whichever tenant happened to sort first. Real
  // bug: a Wyoming deal of JP's, uploaded by Vicki, ended up under
  // Laura Webb's 417 brokerage. Sealed by switching to the actor's
  // accountId from the session, matching the pattern used by every
  // other tenant-owned write route.
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: {
      id: true,
      brokerageProfile: { select: { name: true, agentEmailDomains: true } },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }
  const actingUserId = actor.userId;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const effectiveDate = toDate(body.effectiveDate);
  const closingDate = toDate(body.closingDate);
  const possessionDate = toDate(body.possessionDate);
  const inspectionDeadline = toDate(body.inspectionDeadline);
  const inspectionObjectionDeadline = toDate(body.inspectionObjectionDeadline);
  const titleCommitmentDeadline = toDate(body.titleCommitmentDeadline);
  const titleObjectionDeadline = toDate(body.titleObjectionDeadline);
  const financingDeadline = toDate(body.financingDeadline);
  // Walkthrough: prefer user-supplied date; else apply state-default
  // (e.g. Wyoming = closing - 1 calendar day). State is inferred from
  // the ", XX" trailing the address.
  let walkthroughDate = toDate(body.walkthroughDate);
  let walkthroughDerived = false;
  if (!walkthroughDate && closingDate) {
    const derived = defaultWalkthroughForState(closingDate, body.address);
    if (derived) {
      walkthroughDate = derived;
      walkthroughDerived = true;
    }
  }
  let earnestMoneyDueDate = toDate(body.earnestMoneyDueDate);
  let earnestDueDerived = false;
  if (!earnestMoneyDueDate && effectiveDate) {
    earnestMoneyDueDate = addBusinessDays(effectiveDate, 3);
    earnestDueDerived = true;
  }

  const purchasePrice = toNum(body.purchasePrice);
  const earnestMoneyAmount = toNum(body.earnestMoneyAmount);
  const sellerPct = toNum(body.sellerSideCommissionPct);
  const sellerAmt = toNum(body.sellerSideCommissionAmount);
  const buyerPct = toNum(body.buyerSideCommissionPct);
  const buyerAmt = toNum(body.buyerSideCommissionAmount);

  // Which side the user represents, in priority order:
  //   1. the wizard's explicit side-picker (a human choice — always wins);
  //   2. the DRAFTING firm's side from the contract footer/broker block —
  //      the agent who WROTE the contract represents that side (a buyer's
  //      OFFER is drafted by the buyer's agent → "buy"). This is the
  //      footer-agent signal and beats fuzzy name-presence inference;
  //   3. name-presence fallback (weakest — the source of the old mislabels).
  const explicitSide: "buy" | "sell" | null =
    body.side === "buy" || body.side === "sell" ? body.side : null;
  // Server-side footer signal: find OUR brokerage in the extracted list.
  const matchedFirmSide = resolveFirmSideFromBrokerages(
    body.brokerages,
    account.brokerageProfile?.name,
  );
  // Caller-supplied fallback if it pre-matched our firm (rare).
  const callerFirmSide: "buy" | "sell" | null =
    body.firmSide === "buyer" ? "buy" : body.firmSide === "listing" ? "sell" : null;
  const resolvedSide: "buy" | "sell" =
    explicitSide ??
    matchedFirmSide ??
    callerFirmSide ??
    (body.buyerName?.trim() ? "buy" : "sell");

  // Contact lookup / create — the primary contact is the party the user
  // represents: the SELLER on a sell-side (listing) deal, otherwise the
  // BUYER. Falls back to the other party, then an address placeholder.
  const principalName =
    (resolvedSide === "sell"
      ? body.sellerName?.trim() || body.buyerName?.trim()
      : body.buyerName?.trim() || body.sellerName?.trim()) || null;
  let contact;
  if (principalName) {
    contact = await prisma.contact.findFirst({
      where: {
        accountId: account.id,
        fullName: { equals: principalName, mode: "insensitive" },
      },
    });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          accountId: account.id,
          fullName: principalName,
          sourceName: "Contract upload / scan",
        },
      });
    }
  } else {
    contact = await prisma.contact.create({
      data: {
        accountId: account.id,
        fullName: `Transaction · ${body.address}`,
        sourceName: "Contract upload / scan",
      },
    });
  }

  // Side: the caller's explicit side wins. Otherwise the primary contact
  // is the buyer whenever the contract names one (see principalName), so
  // it's buy-side; only sell-side when there's no buyer. NEVER string-
  // compare contact.fullName to body.buyerName — a fuzzy/case-insensitive
  // contact match makes that fail and silently flips a buy to a sell
  // (this mislabeled investor purchases: the buyer entity showed as the
  // seller).
  const side: "buy" | "sell" = resolvedSide;

  const existing = await prisma.transaction.findFirst({
    where: {
      accountId: account.id,
      contactId: contact.id,
      propertyAddress: { equals: body.address, mode: "insensitive" },
    },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      created: false,
      transactionId: existing.id,
    });
  }

  // Contract stage default — most uploads are executed contracts
  const stage =
    body.contractStage &&
    ["offer", "counter", "executed", "unknown"].includes(body.contractStage)
      ? body.contractStage
      : "executed";

  // ── Investor module (spec §2, §5): auto-detect the deal kind and
  // create the parent Asset (the spine). For a retail Gmail scan no
  // investor signals are present → classifies retail/agency, giving a
  // degenerate 1:1 Asset that's invisible to the existing retail UI.
  // The Transaction links to it via assetId. ──
  const classification = classifyDeal({
    text: body.contractText ?? null,
    hasRehabBudget: body.rehabBudget ?? undefined,
    hasResaleIntent: body.resaleIntent ?? undefined,
    hasRentEstimate: body.rentEstimate ?? undefined,
    hasRefinanceIntent: body.refinanceIntent ?? undefined,
    hasAssignmentClause: body.assignmentClause ?? undefined,
    hasCashBuyerDisposition: body.cashBuyerDisposition ?? undefined,
    twoClosingIntent: body.twoClosingIntent ?? undefined,
    hasClientParty: !!(body.buyerName || body.sellerName),
    hasCommissionExpectation: !!(sellerPct || sellerAmt || buyerPct || buyerAmt),
  });
  const asset = await prisma.asset.create({
    data: {
      accountId: account.id,
      ownerUserId: actingUserId,
      address: body.address.slice(0, 240),
      representation: classification.representation,
      strategy: classification.strategy,
      titlePath: classification.titlePath,
      creativeSubstructure: classification.creativeSubstructure,
    },
  });

  const datesConflictsJson = sanitizeConflicts(body.conflicts);

  const txn = await prisma.transaction.create({
    data: {
      accountId: account.id,
      contactId: contact.id,
      assetId: asset.id,
      propertyAddress: body.address.slice(0, 240),
      transactionType: side === "sell" ? "seller" : "buyer",
      side,
      status: "active",
      contractDate: effectiveDate,
      closingDate,
      possessionDate,
      inspectionDate: inspectionDeadline,
      inspectionObjectionDate: inspectionObjectionDeadline,
      titleDeadline: titleCommitmentDeadline,
      titleObjectionDate: titleObjectionDeadline,
      financingDeadline,
      walkthroughDate,
      earnestMoneyDueDate,
      earnestMoneyAmount,
      titleCompanyName: body.titleCompany?.slice(0, 120) ?? null,
      lenderName: body.lenderName?.slice(0, 120) ?? null,
      contractStage: stage,
      contractAppliedAt: new Date(),
      ...(datesConflictsJson ? { datesConflictsJson } : {}),
      // Default-assign to the creating user so "My queue" populates
      // from day 1. Leave null if this was auto-created by a cron.
      assignedUserId: actingUserId,
      rawSourceJson: {
        origin: "manual_contract_upload_or_scan",
        threadId: body.threadId ?? null,
        earnestDueDerived,
      } as Prisma.InputJsonValue,
    },
  });

  // Funnel: the reviewed facts were approved and a real deal now exists.
  // Fires once per creation (this route persists the deal exactly once).
  await logWorkflowEvent(prisma, {
    accountId: account.id,
    transactionId: txn.id,
    event: "facts_approved",
    actorUserId: actingUserId,
    meta: { side, transactionType: side === "sell" ? "seller" : "buyer", stage },
  });

  // Record the OTHER party — the seller on a buy-side deal, the buyer on
  // a sell-side deal — as a co-participant so both roles show on the deal
  // (the primary contact is the party the user represents).
  const otherName = (side === "sell" ? body.buyerName : body.sellerName)?.trim();
  if (otherName && otherName.toLowerCase() !== (principalName ?? "").toLowerCase()) {
    const otherContact =
      (await prisma.contact.findFirst({
        where: { accountId: account.id, fullName: { equals: otherName, mode: "insensitive" } },
      })) ??
      (await prisma.contact.create({
        data: { accountId: account.id, fullName: otherName, sourceName: "Contract upload / scan" },
      }));
    const otherRole = side === "sell" ? "co_buyer" : "co_seller";
    await prisma.transactionParticipant.upsert({
      where: {
        transactionId_contactId_role: {
          transactionId: txn.id,
          contactId: otherContact.id,
          role: otherRole,
        },
      },
      create: { transactionId: txn.id, contactId: otherContact.id, role: otherRole },
      update: {},
    });
  }

  // Cash deals have no financing contingency; only flag financing as
  // missing when the deal is actually financed.
  const isFinanced = !!(
    body.lenderName?.trim() || financingDeadline
  );
  // Seed ONE milestone per known date so the timeline renders rich.
  // `expected: true` deadlines that come back null are kept as null-date
  // ("needs date") milestones so the TC SEES an unfilled deadline instead
  // of it vanishing — the 7008 failure mode. Others skip when null.
  const milestoneSpec: Array<{
    type: string;
    label: string;
    dueAt: Date | null;
    ownerRole: string;
    expected: boolean;
  }> = [
    { type: "contract_effective", label: "Under contract", dueAt: effectiveDate, ownerRole: "agent", expected: true },
    {
      type: "earnest_money",
      label: earnestDueDerived
        ? "Earnest money due (3 biz days rule)"
        : "Earnest money due",
      dueAt: earnestMoneyDueDate,
      ownerRole: "client",
      expected: true,
    },
    { type: "inspection", label: "Inspection deadline", dueAt: inspectionDeadline, ownerRole: "inspector", expected: true },
    { type: "inspection_objection", label: "Inspection objection deadline", dueAt: inspectionObjectionDeadline, ownerRole: "client", expected: true },
    { type: "title_commitment", label: "Title commitment due", dueAt: titleCommitmentDeadline, ownerRole: "title", expected: false },
    { type: "title_objection", label: "Title objection deadline", dueAt: titleObjectionDeadline, ownerRole: "client", expected: false },
    { type: "financing_approval", label: "Financing approval deadline", dueAt: financingDeadline, ownerRole: "lender", expected: isFinanced },
    {
      type: "walkthrough",
      label: walkthroughDerived
        ? "Final walkthrough (WY rule: close - 1d)"
        : "Final walkthrough",
      dueAt: walkthroughDate,
      ownerRole: "agent",
      expected: false,
    },
    { type: "closing", label: "Closing", dueAt: closingDate, ownerRole: "title", expected: true },
    { type: "possession", label: "Possession", dueAt: possessionDate, ownerRole: "client", expected: false },
  ];
  let milestonesCreated = 0;
  for (const s of milestoneSpec) {
    if (!s.dueAt && !s.expected) continue;
    const missing = !s.dueAt;
    await prisma.milestone.create({
      data: {
        transactionId: txn.id,
        type: s.type,
        label: missing ? `${s.label} — date not found, confirm` : s.label,
        dueAt: s.dueAt,
        ownerRole: s.ownerRole,
        source: "extracted",
        confidenceScore: missing ? 0.3 : 0.9,
      },
    });
    milestonesCreated++;
  }

  // Funnel: the timeline (contractual milestones) was created for this deal.
  if (milestonesCreated > 0) {
    await logWorkflowEvent(prisma, {
      accountId: account.id,
      transactionId: txn.id,
      event: "timeline_approved",
      actorUserId: actingUserId,
      meta: { milestones: milestonesCreated },
    });
  }

  // Financials — pick the side-matching commission. If direct $ given,
  // use it; else compute from pct × price.
  const myPct = side === "sell" ? sellerPct : buyerPct;
  const myAmt = side === "sell" ? sellerAmt : buyerAmt;
  let grossCommission: number | null = null;
  if (myAmt && myAmt > 0) grossCommission = myAmt;
  else if (myPct && purchasePrice) {
    // Accept either 0.025 OR 2.5 — normalize
    const pct = myPct > 1 ? myPct / 100 : myPct;
    grossCommission = Math.round(purchasePrice * pct);
  }

  // Normalize pct: accept 0.025 OR 2.5 → store as 2.5 (human %)
  const myPctRaw = myPct != null ? (myPct > 1 ? myPct : myPct * 100) : null;

  if (purchasePrice !== null || grossCommission !== null || myPctRaw !== null) {
    await prisma.transactionFinancials.upsert({
      where: { transactionId: txn.id },
      create: {
        transactionId: txn.id,
        salePrice: purchasePrice ?? null,
        commissionPercent: myPctRaw,
        grossCommission,
      },
      update: {
        ...(purchasePrice !== null ? { salePrice: purchasePrice } : {}),
        ...(myPctRaw !== null ? { commissionPercent: myPctRaw } : {}),
        ...(grossCommission !== null ? { grossCommission } : {}),
      },
    });
  }

  // Investor stage lifecycle (spec §6): for strategies that have a
  // stage template (wholesale, and later flip/BRRRR/creative), seed
  // stage-1 tasks onto the deal so the PM board starts populated.
  // Retail is a no-op (no lifecycle). Non-blocking — a failure here
  // must not fail the deal creation.
  let stageSeeded: { stageKey: string | null; created: number } | null = null;
  if (hasStageLifecycle(classification.strategy)) {
    try {
      const r = await applyStrategyTemplate(prisma, {
        assetId: asset.id,
        transactionId: txn.id,
      });
      stageSeeded = { stageKey: r.stageKey, created: r.created };
    } catch (err) {
      console.warn(
        "stage seeding on create-from-scan failed (non-blocking):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Funnel: stage-1 tasks were seeded/activated onto the deal (investor
  // lifecycle). Retail deals activate tasks via the generate-tasks route,
  // which emits its own tasks_activated. Only fire when tasks were made.
  if (stageSeeded && stageSeeded.created > 0) {
    await logWorkflowEvent(prisma, {
      accountId: account.id,
      transactionId: txn.id,
      event: "tasks_activated",
      actorUserId: actingUserId,
      meta: { tasks: stageSeeded.created, stageKey: stageSeeded.stageKey ?? undefined },
    });
  }

  // SmartFolder (Contract = Folder skill).
  // Investor deals stay Gmail-quiet through acquisition + rehab — the
  // SmartFolder is deferred until the deal reaches its market-entry
  // stage (Flip→Prep-to-List, Wholesale→Disposition, BRRRR→Lease-Up),
  // where the advance-stage route activates it. Retail deals scaffold
  // immediately as before.
  let smartFolder: unknown = null;
  if (
    classification.representation !== "principal" &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REDIRECT_URI
  ) {
    try {
      const acct = await prisma.account.findUnique({
        where: { id: account.id },
        select: { id: true, googleOauthTokensEncrypted: true },
      });
      if (acct?.googleOauthTokensEncrypted) {
        const oauth = new GoogleOAuthService(
          {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_REDIRECT_URI,
            scopes: DEFAULT_SCOPES,
          },
          prisma,
          getEncryptionService(),
        );
        const gAuth = await oauth.createAuthenticatedClient(account.id);
        const gmail = new GmailService(
          account.id,
          gAuth,
          {
            labelPrefix: "REOS/",
            autoOrganizeThreads: false,
            extractAttachments: false,
            batchSize: 10,
            rateLimitDelayMs: 100,
          },
          prisma,
          new EmailTransactionMatchingService(),
        );
        const audit = new AutomationAuditService(prisma);
        const svc = new SmartFolderService({
          db: prisma,
          auth: gAuth,
          gmail,
          audit,
        });
        smartFolder = await svc.setupForTransaction(txn.id);
      }
    } catch (err) {
      console.warn(
        "SmartFolder setup on create-from-scan failed (non-blocking):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    created: true,
    transactionId: txn.id,
    contactId: contact.id,
    assetId: asset.id,
    classification: {
      strategy: classification.strategy,
      representation: classification.representation,
      titlePath: classification.titlePath,
      confidence: classification.confidence,
    },
    milestonesCreated,
    grossCommission,
    earnestDueDerived,
    stageSeeded,
    smartFolder,
  });
}
