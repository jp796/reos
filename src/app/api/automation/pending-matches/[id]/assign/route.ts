/**
 * POST /api/automation/pending-matches/:id/assign
 *
 * Body: { contactId: string }
 *
 * Takes a manually-chosen contact and runs the same disposition steps the
 * orchestrator would have run if automatic matching had worked:
 *   - Create / find a Transaction for that contact (idempotent)
 *   - Update FUB stage → Pending
 *   - Apply Gmail label "REOS/Transactions/<address>" if we have an address
 *   - Log audit entry
 *   - Mark the PendingEmailMatch row as resolved
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import { GmailLabelService } from "@/services/integrations/GmailLabelService";
import { GmailService, EmailTransactionMatchingService } from "@/services/integrations/GmailService";
import { SmartFolderService } from "@/services/automation/SmartFolderService";
import {
  FollowUpBossService,
  AutomationAuditService,
} from "@/services/integrations/FollowUpBossService";
import {
  TransactionService,
  inferTransactionType,
  inferSide,
  resolveTriggerConfig,
} from "@/services/core/TransactionService";
import { resolveOrchestratorConfig } from "@/services/automation/TitleOrderOrchestrator";
import { extractAddresses, addressToLabel } from "@/lib/address-parser";
import { Prisma } from "@prisma/client";

interface AssignBody {
  contactId?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: AssignBody;
  try {
    body = (await req.json()) as AssignBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  const pending = await prisma.pendingEmailMatch.findUnique({
    where: { id },
  });
  if (!pending) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return NextResponse.json(
      { error: `already ${pending.status}` },
      { status: 409 },
    );
  }

  const contact = await prisma.contact.findFirst({
    where: { id: body.contactId, accountId: pending.accountId },
  });
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  if (!env.FUB_API_KEY) {
    return NextResponse.json(
      { error: "FUB_API_KEY not configured" },
      { status: 500 },
    );
  }

  const account = await prisma.account.findUnique({
    where: { id: pending.accountId },
  });
  if (!account?.googleOauthTokensEncrypted) {
    return NextResponse.json(
      { error: "Google not connected" },
      { status: 412 },
    );
  }

  const audit = new AutomationAuditService(prisma);
  const fub = new FollowUpBossService(
    account.id,
    {
      apiKey: env.FUB_API_KEY,
      systemKey: env.FUB_SYSTEM_KEY,
      webhookSecret: env.FUB_WEBHOOK_SECRET,
    },
    prisma,
    audit,
  );
  const txnSvc = new TransactionService(prisma);

  const config = resolveOrchestratorConfig(account.settingsJson, {});

  // 1. Create/find transaction (idempotent per contact)
  const type = inferTransactionType({
    type:
      (contact.rawFubPayloadJson as Record<string, unknown>)?.type as
        | string
        | undefined,
    tags: ((contact.rawFubPayloadJson as Record<string, unknown>)?.tags ??
      []) as string[],
  });

  // Prefer the address extracted from the email itself (stored on pending row)
  const addrString = pending.extractedAddress ?? undefined;
  const addr = addrString ? extractAddresses(addrString)[0] : undefined;

  const { transaction, created: txnCreated } = await txnSvc.createFromContact({
    accountId: account.id,
    contactId: contact.id,
    fubPersonId: contact.fubPersonId ?? undefined,
    propertyAddress: addr?.raw ?? addrString,
    city: addr?.city,
    state: addr?.state,
    zip: addr?.zip,
    transactionType: type,
    side: inferSide(type),
  });

  // 2. FUB stage → Pending (skip silently if no fubPersonId)
  let fubStageUpdated = false;
  if (contact.fubPersonId) {
    await fub.updatePersonStage(contact.fubPersonId, config.pendingStage, {
      reason: "manual_title_match_assign",
      transactionId: transaction.id,
    });
    fubStageUpdated = true;
  }

  // 3. Gmail label + SmartFolder setup (best-effort — requires Google auth)
  let labelApplied: string | null = null;
  let smartFolderResult: unknown = null;
  try {
    const oauth = new GoogleOAuthService(
      {
        clientId: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        redirectUri: env.GOOGLE_REDIRECT_URI!,
        scopes: DEFAULT_SCOPES,
      },
      prisma,
      getEncryptionService(),
    );
    const gAuth = await oauth.createAuthenticatedClient(account.id);
    const labels = new GmailLabelService(gAuth);
    if (addr) {
      const labelName = labels.labelNameFor(addressToLabel(addr));
      await labels.applyToThread(pending.threadId, labelName);
      labelApplied = labelName;
    }

    // SmartFolder setup for newly-created transactions at/after the cutoff.
    if (txnCreated) {
      try {
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
        const smartFolder = new SmartFolderService({
          db: prisma,
          auth: gAuth,
          gmail,
          audit,
        });
        smartFolderResult = await smartFolder.setupForTransaction(transaction.id);
      } catch (err) {
        console.warn("SmartFolder setup failed on manual assign:", err);
      }
    }
  } catch (err) {
    console.warn("Gmail label apply failed on manual assign:", err);
  }

  // 4. Audit
  await audit.logAction({
    accountId: account.id,
    transactionId: transaction.id,
    entityType: "transaction",
    entityId: transaction.id,
    ruleName: "manual_title_match_assign",
    actionType: "update",
    sourceType: "manual",
    confidenceScore: 1.0,
    decision: "applied",
    beforeJson: null,
    afterJson: {
      threadId: pending.threadId,
      subject: pending.subject,
      fromEmail: pending.fromEmail,
      pendingMatchId: pending.id,
      contactId: contact.id,
      txnCreated,
      fubStageUpdated,
      labelApplied,
    } as Prisma.InputJsonValue,
  });

  // 5. Mark pending row resolved
  await prisma.pendingEmailMatch.update({
    where: { id: pending.id },
    data: {
      status: "resolved",
      resolvedContactId: contact.id,
      resolvedTransactionId: transaction.id,
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    transactionId: transaction.id,
    txnCreated,
    fubStageUpdated,
    labelApplied,
    smartFolder: smartFolderResult,
  });
}
