/**
 * POST /api/transactions/:id/resync
 *
 * "Re-sync deal from sources" — one robust action that:
 *   1. re-reads the contract (fills MISSING dates + milestones + tasks;
 *      never overwrites a human edit — RescanDealService),
 *   2. reconciles the whole document set (synthesizeDeal), and
 *   3. pulls the Gmail smart-folder threads onto the deal (rebackfill).
 *
 * Each source is best-effort and isolated: one failing step never breaks the
 * others, and the response reports exactly what each step did. Tenant-scoped.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";
import { rescanDeal } from "@/services/core/RescanDealService";
import { synthesizeDeal } from "@/services/core/DocumentSynthesisService";
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
export const maxDuration = 120;

interface StepResult {
  ok: boolean;
  summary: string;
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true, propertyAddress: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  const steps: Record<string, StepResult> = {};

  // 1 — Re-read the contract (fills missing dates + milestones + tasks).
  try {
    const r = await rescanDeal(prisma, txn.accountId, id);
    steps.contract = {
      ok: !r.noContract,
      summary: r.noContract
        ? "No contract attached — nothing to re-read."
        : r.summary,
    };
  } catch (e) {
    steps.contract = { ok: false, summary: `Contract re-read failed: ${errMsg(e)}` };
  }

  // 2 — Reconcile the whole document set (contract + addenda/notices).
  try {
    const s = await synthesizeDeal(prisma, txn.accountId, id, false);
    steps.reconcile = {
      ok: !!s,
      summary: s
        ? `Reconciled ${s.analyzedCount}/${s.docCount} document(s).`
        : "Nothing to reconcile.",
    };
  } catch (e) {
    steps.reconcile = { ok: false, summary: `Reconcile failed: ${errMsg(e)}` };
  }

  // 3 — Pull the Gmail smart-folder threads onto the deal.
  try {
    steps.gmail = await pullGmail(txn.accountId, id);
  } catch (e) {
    steps.gmail = { ok: false, summary: `Gmail sync failed: ${errMsg(e)}` };
  }

  const okCount = Object.values(steps).filter((s) => s.ok).length;
  const summary = Object.entries(steps)
    .map(([k, v]) => `${label(k)}: ${v.summary}`)
    .join(" · ");

  return NextResponse.json({ ok: okCount > 0, steps, summary });
}

function label(k: string): string {
  return k === "contract" ? "Contract" : k === "reconcile" ? "Documents" : "Gmail";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 140) : "unknown error";
}

async function pullGmail(accountId: string, txnId: string): Promise<StepResult> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) {
    return { ok: false, summary: "Gmail not connected — connect Google in Settings." };
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return { ok: false, summary: "Google OAuth not configured." };
  }
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
  const gAuth = await oauth.createAuthenticatedClient(accountId);
  const gmail = new GmailService(
    accountId,
    gAuth,
    { labelPrefix: "REOS/", autoOrganizeThreads: false, extractAttachments: false, batchSize: 10, rateLimitDelayMs: 100 },
    prisma,
    new EmailTransactionMatchingService(),
  );
  const audit = new AutomationAuditService(prisma);
  const svc = new SmartFolderService({ db: prisma, auth: gAuth, gmail, audit });
  const result = await svc.rebackfill(txnId);
  if (!result.ok) {
    const why =
      result.reason === "no_property_address"
        ? "the deal has no property address to search by yet"
        : result.reason === "no_search_criteria"
          ? "no address or party email to search by"
          : (result.reason ?? "unknown");
    return { ok: false, summary: `Gmail sync skipped — ${why}.` };
  }
  const n = result.newlyLabeled ?? 0;
  return {
    ok: true,
    summary: n > 0 ? `Pulled ${n} email thread(s) into the deal folder.` : "Deal folder already current — no new threads.",
  };
}
