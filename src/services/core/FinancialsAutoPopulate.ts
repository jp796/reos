/**
 * FinancialsAutoPopulate
 *
 * Given a transaction that just had a closing date applied from a
 * Settlement Statement, re-download that SS attachment, extract sale
 * price + gross commission, look up the referral agreement for the
 * contact's source, compute net, and upsert TransactionFinancials.
 *
 * Pure side-effect function. Errors are swallowed and returned so the
 * caller can audit — never blocks the core Apply flow.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import type { GmailService } from "@/services/integrations/GmailService";
import { DocumentExtractionService } from "@/services/ai/DocumentExtractionService";
import type { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import {
  lookupReferralForSource,
  resolveReferralAgreements,
  computeReferral,
  type ReferralAgreement,
} from "./ReferralAgreements";

export interface AutoPopulateArgs {
  accountId: string;
  transactionId: string;
  threadId: string | null;
  attachmentId: string | null;
  side: "buy" | "sell" | null;
}

export interface AutoPopulateResult {
  attempted: boolean;
  populated: boolean;
  reason?: string;
  salePrice?: number;
  grossCommission?: number;
  commissionInferredHalf?: boolean;
  referralAgreement?: ReferralAgreement | null;
  referralFeeAmount?: number;
  netCommission?: number;
}

export async function autoPopulateFinancials(
  db: PrismaClient,
  gmail: GmailService | null,
  audit: AutomationAuditService,
  args: AutoPopulateArgs,
): Promise<AutoPopulateResult> {
  if (!gmail) {
    return { attempted: false, populated: false, reason: "gmail_unavailable" };
  }
  if (!args.attachmentId || !args.threadId) {
    return { attempted: false, populated: false, reason: "no_attachment_ref" };
  }

  const txn = await db.transaction.findUnique({
    where: { id: args.transactionId },
    include: {
      contact: true,
      financials: true,
    },
  });
  if (!txn) return { attempted: false, populated: false, reason: "txn_not_found" };

  const account = await db.account.findUnique({
    where: { id: args.accountId },
    select: { settingsJson: true },
  });
  const agreements = resolveReferralAgreements(account?.settingsJson ?? null);

  // Find the SS attachment on the thread. Try the exact stored
  // attachmentId first; if that's stale (Gmail rotates them), fall back
  // to any filename matching SS patterns within this thread.
  const thread = await gmail.getThread(args.threadId);
  if (!thread?.messages) {
    return { attempted: true, populated: false, reason: "thread_not_found" };
  }

  const SS_FILENAME_PATTERNS: RegExp[] = [
    /settlement[_\s-]*statement/i,
    /closing[_\s-]*disclosure/i,
    /alta.*settlement/i,
    /\bcd\b.*\.pdf$/i,
    /hud[-\s]?1/i,
    /final.*cd/i,
    /final.*settlement/i,
  ];

  let hit: { messageId: string; attachmentId: string } | null = null;
  let fallback: { messageId: string; attachmentId: string } | null = null;
  for (const m of thread.messages) {
    if (!m.id) continue;
    const list = await gmail.getMessageAttachments(m.id);
    for (const a of list) {
      if (a.attachmentId === args.attachmentId) {
        hit = { messageId: m.id, attachmentId: a.attachmentId };
        break;
      }
      if (!fallback && SS_FILENAME_PATTERNS.some((p) => p.test(a.filename))) {
        fallback = { messageId: m.id, attachmentId: a.attachmentId };
      }
    }
    if (hit) break;
  }
  const atts = hit ? [hit] : fallback ? [fallback] : [];
  if (atts.length === 0) {
    return { attempted: true, populated: false, reason: "attachment_not_found" };
  }

  let buffer: Buffer;
  try {
    buffer = await gmail.downloadAttachment(atts[0].messageId, atts[0].attachmentId);
  } catch (err) {
    return {
      attempted: true,
      populated: false,
      reason: `download_failed:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const extraction = await new DocumentExtractionService().extractFinancials(
    buffer,
    args.side,
  );
  if (!extraction || (!extraction.salePrice && !extraction.grossCommission)) {
    await audit.logAction({
      accountId: args.accountId,
      transactionId: args.transactionId,
      entityType: "transaction",
      entityId: args.transactionId,
      ruleName: "commission_auto_populate",
      actionType: "update",
      sourceType: "document_extraction",
      confidenceScore: 0,
      decision: "failed",
      beforeJson: null,
      afterJson: { reason: "extraction_no_match" } as Prisma.InputJsonValue,
    });
    return { attempted: true, populated: false, reason: "extraction_no_match" };
  }

  // Look up referral
  const agreement = lookupReferralForSource(txn.contact.sourceName, agreements);

  let referralFeeAmount: number | undefined;
  let referralFeePercent: number | undefined;
  if (agreement && extraction.grossCommission) {
    const ref = computeReferral(
      extraction.grossCommission,
      agreement.referralPercent,
    );
    referralFeeAmount = ref.amount;
    referralFeePercent = agreement.referralPercent;
  } else if (extraction.referralEmbedded) {
    // SS itself deducted a referral — honor that number even with no agreement
    referralFeeAmount = extraction.referralEmbedded;
  }

  // Compute net (gross − referral − brokerage split − marketing)
  const brokerageSplit = txn.financials?.brokerageSplitAmount ?? 0;
  const marketing = txn.financials?.marketingCostAllocated ?? 0;
  const gross = extraction.grossCommission ?? null;
  const net =
    gross !== null
      ? Math.round(
          (gross - (referralFeeAmount ?? 0) - brokerageSplit - marketing) * 100,
        ) / 100
      : null;

  const before = txn.financials
    ? {
        salePrice: txn.financials.salePrice,
        grossCommission: txn.financials.grossCommission,
        referralFeePercent: txn.financials.referralFeePercent,
        referralFeeAmount: txn.financials.referralFeeAmount,
        netCommission: txn.financials.netCommission,
      }
    : null;

  await db.transactionFinancials.upsert({
    where: { transactionId: args.transactionId },
    update: {
      salePrice: extraction.salePrice ?? null,
      grossCommission: gross,
      referralFeePercent: referralFeePercent ?? null,
      referralFeeAmount: referralFeeAmount ?? null,
      netCommission: net,
    },
    create: {
      transactionId: args.transactionId,
      salePrice: extraction.salePrice ?? null,
      grossCommission: gross,
      referralFeePercent: referralFeePercent ?? null,
      referralFeeAmount: referralFeeAmount ?? null,
      netCommission: net,
    },
  });

  await audit.logAction({
    accountId: args.accountId,
    transactionId: args.transactionId,
    entityType: "transaction",
    entityId: args.transactionId,
    ruleName: "commission_auto_populate",
    actionType: "update",
    sourceType: "document_extraction",
    confidenceScore: extraction.commissionInferredHalf ? 0.7 : 1.0,
    decision: "applied",
    beforeJson: before as unknown as Prisma.InputJsonValue,
    afterJson: {
      salePrice: extraction.salePrice,
      grossCommission: gross,
      referralFeePercent,
      referralFeeAmount,
      netCommission: net,
      anchors: extraction.anchors,
      snippets: extraction.snippets.slice(0, 3),
      agreement: agreement
        ? {
            sourceMatch: agreement.sourceMatch,
            referralPercent: agreement.referralPercent,
          }
        : null,
      commissionInferredHalf: extraction.commissionInferredHalf ?? false,
      referralEmbeddedOnSS: extraction.referralEmbedded,
    } as Prisma.InputJsonValue,
  });

  return {
    attempted: true,
    populated: true,
    salePrice: extraction.salePrice,
    grossCommission: gross ?? undefined,
    commissionInferredHalf: extraction.commissionInferredHalf,
    referralAgreement: agreement,
    referralFeeAmount,
    netCommission: net ?? undefined,
  };
}
