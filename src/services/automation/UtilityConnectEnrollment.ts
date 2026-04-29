/**
 * UtilityConnectEnrollment
 *
 * Bridge between REOS transactions and Utility Connect's POST /lead.
 * Builds the lead body from Transaction + primary Contact, fires
 * the API call, persists the returned IDs back on the transaction,
 * and writes an audit row. Idempotent — refuses to re-enroll a
 * transaction that already has a utilityConnectLeadId.
 *
 * Used by:
 *   - Manual button on the transaction page (POST /api/transactions/:id/utility-connect/enroll)
 *   - Daily cron tick that auto-enrolls 7-10 days before close
 */

import type { PrismaClient, Transaction, Contact } from "@prisma/client";
import {
  UtilityConnectService,
  type UCLeadInput,
} from "@/services/integrations/UtilityConnectService";

export interface EnrollResult {
  ok: boolean;
  alreadyEnrolled?: boolean;
  reason?: string;
  customerId?: number;
  leadId?: string;
  referenceCode?: string;
}

export interface EnrollContext {
  /** Optional override agent email (else falls back to actor / brokerage). */
  agentEmail?: string;
}

/** Format a JS Date as MM-DD-YYYY for UC's `move_in_date`. */
function fmtMoveInDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

/** Best-effort phone digits (UC seems flexible but a clean 10-digit
 * string never hurts). */
function cleanPhone(p: string | null | undefined): string {
  if (!p) return "";
  return p.replace(/\D/g, "").slice(-10);
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

export async function enrollTransactionInUtilityConnect(
  db: PrismaClient,
  txn: Transaction & { contact: Contact },
  ctx: EnrollContext = {},
): Promise<EnrollResult> {
  if (txn.utilityConnectLeadId) {
    return { ok: true, alreadyEnrolled: true };
  }
  if (!UtilityConnectService.isConfigured()) {
    return { ok: false, reason: "uc_not_configured" };
  }
  if (!txn.propertyAddress || !txn.city || !txn.state || !txn.zip) {
    return { ok: false, reason: "incomplete_address" };
  }
  const phone = cleanPhone(txn.contact.primaryPhone);
  if (!phone) {
    return { ok: false, reason: "missing_phone" };
  }
  const { first, last } = splitName(txn.contact.fullName);
  if (!first || !last) {
    return { ok: false, reason: "incomplete_name" };
  }

  const txnType: "buyer" | "seller" =
    txn.side === "sell" ? "seller" : "buyer";

  const lead: UCLeadInput = {
    firstname: first,
    lastname: last,
    primary_phone: phone,
    address1: txn.propertyAddress,
    city: txn.city,
    zipcode: txn.zip,
    state: txn.state.toUpperCase(),
    email: txn.contact.primaryEmail ?? undefined,
    move_in_date: txn.closingDate ? fmtMoveInDate(txn.closingDate) : undefined,
    transaction_type: txnType,
    agent_email: ctx.agentEmail,
  };

  const uc = new UtilityConnectService();
  const resp = await uc.createLead(lead);

  await db.transaction.update({
    where: { id: txn.id },
    data: {
      utilityConnectCustomerId: resp.customer_id,
      utilityConnectLeadId: resp.lead_id,
      utilityConnectReferenceCode: resp.reference_code,
      utilityConnectEnrolledAt: new Date(),
    },
  });

  // Audit
  try {
    await db.automationAuditLog.create({
      data: {
        accountId: txn.accountId,
        transactionId: txn.id,
        entityType: "transaction",
        entityId: txn.id,
        ruleName: "utility_connect_enroll",
        actionType: "create",
        sourceType: "automation",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: { utilityConnectLeadId: null },
        afterJson: {
          customer_id: resp.customer_id,
          lead_id: resp.lead_id,
          reference_code: resp.reference_code,
        },
      },
    });
  } catch {
    // audit failure shouldn't block enrollment
  }

  return {
    ok: true,
    customerId: resp.customer_id,
    leadId: resp.lead_id,
    referenceCode: resp.reference_code,
  };
}

/**
 * Find every active buyer-side transaction whose closingDate is in
 * 7-10 days (inclusive) and has no UC lead yet. For each, fire
 * enrollTransactionInUtilityConnect and roll up the result.
 */
export async function tickUtilityConnect(db: PrismaClient): Promise<{
  scanned: number;
  enrolled: number;
  skipped: number;
  errors: Array<{ id: string; reason: string }>;
}> {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(now.getTime() + 7 * dayMs);
  const end = new Date(now.getTime() + 10 * dayMs);

  const txns = await db.transaction.findMany({
    where: {
      status: { notIn: ["closed", "dead"] },
      side: { in: ["buy", "both"] },
      utilityConnectLeadId: null,
      closingDate: { gte: start, lte: end },
    },
    include: { contact: true },
  });

  let enrolled = 0;
  let skipped = 0;
  const errors: Array<{ id: string; reason: string }> = [];

  for (const txn of txns) {
    try {
      const r = await enrollTransactionInUtilityConnect(db, txn);
      if (r.ok && !r.alreadyEnrolled) enrolled++;
      else if (r.alreadyEnrolled) skipped++;
      else errors.push({ id: txn.id, reason: r.reason ?? "unknown" });
    } catch (e) {
      errors.push({
        id: txn.id,
        reason: e instanceof Error ? e.message : "throw",
      });
    }
  }

  return { scanned: txns.length, enrolled, skipped, errors };
}
