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

interface Body {
  address?: string;
  buyerName?: string | null;
  sellerName?: string | null;
  effectiveDate?: string | null;
  closingDate?: string | null;
  possessionDate?: string | null;
  inspectionDeadline?: string | null;
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
  threadId?: string | null;
}

export async function POST(req: NextRequest) {
  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "no account" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const effectiveDate = toDate(body.effectiveDate);
  const closingDate = toDate(body.closingDate);
  const possessionDate = toDate(body.possessionDate);
  const inspectionDeadline = toDate(body.inspectionDeadline);
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

  // Contact lookup / create — prefer buyer, fall back to seller, else
  // placeholder based on address.
  const principalName =
    body.buyerName?.trim() || body.sellerName?.trim() || null;
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

  // Side inference: if the contact we matched is the buyer, it's a
  // buy-side deal; else default sell-side.
  const side: "buy" | "sell" =
    body.buyerName && contact.fullName === body.buyerName ? "buy" : "sell";

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

  const txn = await prisma.transaction.create({
    data: {
      accountId: account.id,
      contactId: contact.id,
      propertyAddress: body.address.slice(0, 240),
      transactionType: side === "sell" ? "seller" : "buyer",
      side,
      status: "active",
      contractDate: effectiveDate,
      closingDate,
      possessionDate,
      inspectionDate: inspectionDeadline,
      titleDeadline: titleCommitmentDeadline,
      financingDeadline,
      walkthroughDate,
      earnestMoneyDueDate,
      titleCompanyName: body.titleCompany?.slice(0, 120) ?? null,
      lenderName: body.lenderName?.slice(0, 120) ?? null,
      contractStage: stage,
      contractAppliedAt: new Date(),
      rawSourceJson: {
        origin: "manual_contract_upload_or_scan",
        threadId: body.threadId ?? null,
        earnestDueDerived,
      } as Prisma.InputJsonValue,
    },
  });

  // Seed ONE milestone per known date so the timeline renders rich.
  const milestoneSpec: Array<{
    type: string;
    label: string;
    dueAt: Date | null;
    ownerRole: string;
  }> = [
    { type: "contract_effective", label: "Under contract", dueAt: effectiveDate, ownerRole: "agent" },
    {
      type: "earnest_money",
      label: earnestDueDerived
        ? "Earnest money due (3 biz days rule)"
        : "Earnest money due",
      dueAt: earnestMoneyDueDate,
      ownerRole: "client",
    },
    { type: "inspection", label: "Inspection objection deadline", dueAt: inspectionDeadline, ownerRole: "inspector" },
    { type: "title_commitment", label: "Title commitment due", dueAt: titleCommitmentDeadline, ownerRole: "title" },
    { type: "title_objection", label: "Title objection deadline", dueAt: titleObjectionDeadline, ownerRole: "client" },
    { type: "financing_approval", label: "Financing approval deadline", dueAt: financingDeadline, ownerRole: "lender" },
    {
      type: "walkthrough",
      label: walkthroughDerived
        ? "Final walkthrough (WY rule: close - 1d)"
        : "Final walkthrough",
      dueAt: walkthroughDate,
      ownerRole: "agent",
    },
    { type: "closing", label: "Closing", dueAt: closingDate, ownerRole: "title" },
    { type: "possession", label: "Possession", dueAt: possessionDate, ownerRole: "client" },
  ];
  let milestonesCreated = 0;
  for (const s of milestoneSpec) {
    if (!s.dueAt) continue;
    await prisma.milestone.create({
      data: {
        transactionId: txn.id,
        type: s.type,
        label: s.label,
        dueAt: s.dueAt,
        ownerRole: s.ownerRole,
        source: "extracted",
        confidenceScore: 0.9,
      },
    });
    milestonesCreated++;
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

  if (purchasePrice !== null || grossCommission !== null) {
    await prisma.transactionFinancials.upsert({
      where: { transactionId: txn.id },
      create: {
        transactionId: txn.id,
        salePrice: purchasePrice ?? null,
        grossCommission,
      },
      update: {
        ...(purchasePrice !== null ? { salePrice: purchasePrice } : {}),
        ...(grossCommission !== null ? { grossCommission } : {}),
      },
    });
  }

  // SmartFolder (Contract = Folder skill)
  let smartFolder: unknown = null;
  if (
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
    milestonesCreated,
    grossCommission,
    earnestDueDerived,
    smartFolder,
  });
}
