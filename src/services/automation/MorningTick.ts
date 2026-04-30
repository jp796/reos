/**
 * MorningTick — Atlas's 8am daily brief.
 *
 * Runs four steps in order, accumulating a structured result:
 *   1. AcceptedContractScanService — pull NEW deals from Gmail
 *      (catches contracts sent overnight by outside TCs).
 *   2. DocumentClassifierService — auto-classify any unclassified
 *      Documents on open transactions so the Rezen prep panel is
 *      accurate before Vicki opens her laptop.
 *   3. Aggregate Rezen prep status across all open deals — compute
 *      "ready to push" vs "still missing required" buckets.
 *   4. Format a Telegram-friendly brief and send it. If Telegram
 *      isn't configured, the run still completes; it just skips
 *      the notification step.
 *
 * Idempotent enough: step 1 already de-dupes via threadId;
 * step 2 only touches Documents with suggestedRezenSlot == null.
 */

import type { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { getEncryptionService } from "@/lib/encryption";
import {
  GoogleOAuthService,
  DEFAULT_SCOPES,
} from "@/services/integrations/GoogleOAuthService";
import {
  GmailService,
  EmailTransactionMatchingService,
} from "@/services/integrations/GmailService";
import { ContractExtractionService } from "@/services/ai/ContractExtractionService";
import { AcceptedContractScanService } from "@/services/automation/AcceptedContractScanService";
import { classifyDocument } from "@/services/ai/DocumentClassifierService";
import { buildRezenPrepReport } from "@/services/core/RezenCompliancePrep";
import { TelegramService } from "@/services/integrations/TelegramService";
import { TimelineUpdateService } from "@/services/automation/TimelineUpdateService";
import { AutomationAuditService } from "@/services/integrations/FollowUpBossService";
import { autoLinkSendersForTransaction } from "@/services/core/ContactRoleInferenceService";
import { logError } from "@/lib/log";

interface MorningTickResult {
  startedAt: string;
  finishedAt: string;
  contractScan: {
    scanned: number;
    extracted: number;
    hits: number;
    skippedNoExec: number;
  } | null;
  autoLink: {
    dealsScanned: number;
    sendersScanned: number;
    participantsAdded: number;
  } | null;
  earnestMoneyScan: {
    scanned: number;
    completed: number;
  } | null;
  classification: {
    scanned: number;
    classified: number;
    nullified: number;
    errored: number;
  };
  rezen: {
    activeDeals: number;
    readyToPush: number;
    missingRequired: number;
    bestGap: Array<{ id: string; address: string; missing: string[] }>;
  };
  notification: { sent: boolean; reason?: string };
}

const MAX_CLASSIFY_PER_TICK = 80; // ~2¢ at gpt-4o-mini

export async function runMorningTick(
  db: PrismaClient,
): Promise<MorningTickResult> {
  const startedAt = new Date();

  /* ============================================================
   * Step 1 — Pull new contracts from Gmail
   * ============================================================ */
  let contractScan: MorningTickResult["contractScan"] = null;
  try {
    const account = await db.account.findFirst({
      select: { id: true, googleOauthTokensEncrypted: true, settingsJson: true },
    });
    if (
      account?.googleOauthTokensEncrypted &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REDIRECT_URI &&
      env.OPENAI_API_KEY
    ) {
      const oauth = new GoogleOAuthService(
        {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI,
          scopes: DEFAULT_SCOPES,
        },
        db,
        getEncryptionService(),
      );
      const gAuth = await oauth.createAuthenticatedClient(account.id);
      const gmail = new GmailService(
        account.id,
        gAuth,
        {
          labelPrefix: "REOS/",
          autoOrganizeThreads: false,
          extractAttachments: true,
          batchSize: 10,
          rateLimitDelayMs: 100,
        },
        db,
        new EmailTransactionMatchingService(),
      );
      const settings = (account.settingsJson ?? {}) as Record<string, unknown>;
      const trustedSenders = Array.isArray(settings.trustedTcSenders)
        ? (settings.trustedTcSenders as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      const svc = new AcceptedContractScanService(
        db,
        gmail,
        new ContractExtractionService(env.OPENAI_API_KEY),
      );
      const r = await svc.scan({ days: 3, trustedSenders });
      contractScan = {
        scanned: r.scanned,
        extracted: r.extracted,
        hits: r.hits.length,
        skippedNoExec: r.skippedNoExec,
      };
    }
  } catch (e) {
    logError(e, { route: "MorningTick.contractScan" });
  }

  /* ============================================================
   * Step 1.4 — Auto-link senders → participants
   * For each open deal's smart folder (or recent address-anchored
   * inbox window), harvest unique sender emails and auto-promote
   * any we recognize from history / domain into participants.
   * Run BEFORE the EM scan so EM benefits from the new links.
   * ============================================================ */
  let autoLink: MorningTickResult["autoLink"] = null;
  try {
    const account = await db.account.findFirst({
      select: { id: true, googleOauthTokensEncrypted: true },
    });
    if (
      account?.googleOauthTokensEncrypted &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REDIRECT_URI
    ) {
      const oauth = new GoogleOAuthService(
        {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI,
          scopes: DEFAULT_SCOPES,
        },
        db,
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
        db,
        new EmailTransactionMatchingService(),
      );
      const ownerAliases = (env.OWNER_EMAIL_ALIASES ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const openTxns = await db.transaction.findMany({
        where: {
          accountId: account.id,
          status: { notIn: ["closed", "dead"] },
          propertyAddress: { not: null },
        },
        select: { id: true, propertyAddress: true, smartFolderLabelId: true },
        take: 30,
      });

      let dealsScanned = 0;
      let sendersScanned = 0;
      let participantsAdded = 0;

      for (const t of openTxns) {
        if (!t.propertyAddress) continue;
        dealsScanned++;
        // Harvest sender emails from the smart folder (preferred) or
        // a 3-token address-anchored window over the last 30 days.
        const tokens = t.propertyAddress
          .replace(/^\s*(?:TBD|Lot\s*#?\s*\d+)\s*[\/-]?\s*/i, "")
          .split(",")[0]
          ?.trim()
          .split(/\s+/)
          .slice(0, 3)
          .join(" ");
        const q = t.smartFolderLabelId
          ? `label:"REOS/Transactions/${t.propertyAddress.replace(/\//g, "—").trim().slice(0, 150)}" newer_than:30d`
          : tokens
            ? `subject:"${tokens}" newer_than:30d`
            : null;
        if (!q) continue;
        try {
          const { threads } = await gmail.searchThreadsPaged({
            q,
            maxTotal: 25,
          });
          const seen = new Set<string>();
          for (const thread of threads) {
            for (const m of thread.messages ?? []) {
              const fromHeader =
                m.payload?.headers?.find(
                  (h) => h.name?.toLowerCase() === "from",
                )?.value ?? "";
              const match = fromHeader.match(/<([^>]+)>/);
              const email = (match?.[1] ?? fromHeader).trim().toLowerCase();
              if (email.includes("@")) seen.add(email);
            }
          }
          if (seen.size === 0) continue;
          const r = await autoLinkSendersForTransaction(db, {
            transactionId: t.id,
            senderEmails: [...seen],
            ownerAliases,
          });
          sendersScanned += r.scanned;
          participantsAdded += r.added;
        } catch (e) {
          logError(e, {
            route: "MorningTick.autoLink",
            transactionId: t.id,
          });
        }
      }
      autoLink = { dealsScanned, sendersScanned, participantsAdded };
    }
  } catch (e) {
    logError(e, { route: "MorningTick.autoLink.outer" });
  }

  /* ============================================================
   * Step 1.5 — Earnest-money receipt scan
   * Marks the EM milestone complete on any active deal where
   * Gmail shows a deposit / receipt email from a known
   * participant. New participant-sender fallback catches emails
   * like "Deposit" / "Earnest money" that omit the address.
   * ============================================================ */
  let earnestMoneyScan: MorningTickResult["earnestMoneyScan"] = null;
  try {
    const account = await db.account.findFirst({
      select: { id: true, googleOauthTokensEncrypted: true },
    });
    if (
      account?.googleOauthTokensEncrypted &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REDIRECT_URI
    ) {
      const oauth = new GoogleOAuthService(
        {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI,
          scopes: DEFAULT_SCOPES,
        },
        db,
        getEncryptionService(),
      );
      const gAuth = await oauth.createAuthenticatedClient(account.id);
      const gmail = new GmailService(
        account.id,
        gAuth,
        {
          labelPrefix: "REOS/",
          autoOrganizeThreads: false,
          extractAttachments: true,
          batchSize: 10,
          rateLimitDelayMs: 100,
        },
        db,
        new EmailTransactionMatchingService(),
      );
      const audit = new AutomationAuditService(db);
      const tlSvc = new TimelineUpdateService(db, gmail, audit);
      const r = await tlSvc.scanEarnestMoney(account.id);
      earnestMoneyScan = { scanned: r.scanned, completed: r.completed };
    }
  } catch (e) {
    logError(e, { route: "MorningTick.earnestMoneyScan" });
  }

  /* ============================================================
   * Step 2 — Classify any unclassified Documents on open deals
   * ============================================================ */
  const classification = {
    scanned: 0,
    classified: 0,
    nullified: 0,
    errored: 0,
  };
  if (env.OPENAI_API_KEY) {
    const docs = await db.document.findMany({
      where: {
        suggestedRezenSlot: null,
        transaction: {
          status: { notIn: ["closed", "dead"] },
        },
      },
      select: {
        id: true,
        fileName: true,
        extractedText: true,
        transactionId: true,
        transaction: { select: { accountId: true } },
      },
      orderBy: { uploadedAt: "desc" },
      take: MAX_CLASSIFY_PER_TICK,
    });

    for (const doc of docs) {
      classification.scanned++;
      try {
        const r = await classifyDocument({
          filename: doc.fileName,
          extractedText: doc.extractedText,
          openaiApiKey: env.OPENAI_API_KEY,
        });
        await db.document.update({
          where: { id: doc.id },
          data: {
            suggestedRezenSlot: r.slotKey,
            suggestedRezenConfidence: r.confidence,
            classifiedAt: new Date(),
          },
        });
        if (r.slotKey) classification.classified++;
        else classification.nullified++;
      } catch (e) {
        classification.errored++;
        logError(e, {
          route: "MorningTick.classify",
          transactionId: doc.transactionId,
          accountId: doc.transaction.accountId,
          meta: { docId: doc.id },
        });
      }
    }
  }

  /* ============================================================
   * Step 3 — Aggregate Rezen prep status
   * ============================================================ */
  const openTxns = await db.transaction.findMany({
    where: { status: { notIn: ["closed", "dead"] } },
    select: {
      id: true,
      side: true,
      propertyAddress: true,
      contact: { select: { fullName: true } },
      documents: {
        select: {
          id: true,
          fileName: true,
          category: true,
          extractedText: true,
          source: true,
          suggestedRezenSlot: true,
          suggestedRezenConfidence: true,
        },
      },
    },
  });

  let readyToPush = 0;
  let missingRequiredCount = 0;
  const gapList: Array<{ id: string; address: string; missing: string[] }> = [];

  for (const t of openTxns) {
    const showT = t.side !== "sell";
    const showL = t.side === "sell" || t.side === "both";
    const reports: ReturnType<typeof buildRezenPrepReport>[] = [];
    if (showT)
      reports.push(
        buildRezenPrepReport({
          side: t.side,
          documents: t.documents,
          kind: "transaction",
        }),
      );
    if (showL)
      reports.push(
        buildRezenPrepReport({
          side: t.side,
          documents: t.documents,
          kind: "listing",
        }),
      );
    const totalRequired = reports.reduce((s, r) => s + r.requiredMissing, 0);
    if (totalRequired === 0) {
      readyToPush++;
    } else {
      missingRequiredCount++;
      const missing: string[] = [];
      for (const r of reports) {
        for (const item of r.items) {
          if (item.status === "missing" && item.slot.required === "required") {
            missing.push(item.slot.label);
          }
        }
      }
      gapList.push({
        id: t.id,
        address: t.propertyAddress ?? t.contact.fullName,
        missing: missing.slice(0, 5), // cap so brief stays readable
      });
    }
  }
  const bestGap = gapList.slice(0, 5);

  /* ============================================================
   * Step 4 — Send Telegram brief
   * ============================================================ */
  const notification: MorningTickResult["notification"] = { sent: false };
  if (TelegramService.isConfigured()) {
    try {
      const tg = new TelegramService();
      const text = formatBrief({
        contractScan,
        autoLink,
        earnestMoneyScan,
        classification,
        rezen: {
          activeDeals: openTxns.length,
          readyToPush,
          missingRequired: missingRequiredCount,
          bestGap,
        },
      });
      await tg.sendMessage(text);
      notification.sent = true;
    } catch (e) {
      notification.reason = e instanceof Error ? e.message : "unknown";
      logError(e, { route: "MorningTick.notify" });
    }
  } else {
    notification.reason = "telegram_not_configured";
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    contractScan,
    autoLink,
    earnestMoneyScan,
    classification,
    rezen: {
      activeDeals: openTxns.length,
      readyToPush,
      missingRequired: missingRequiredCount,
      bestGap,
    },
    notification,
  };
}

/** Format a tight Markdown brief. ≤ 4096 chars (Telegram limit). */
function formatBrief(args: {
  contractScan: MorningTickResult["contractScan"];
  autoLink: MorningTickResult["autoLink"];
  earnestMoneyScan: MorningTickResult["earnestMoneyScan"];
  classification: MorningTickResult["classification"];
  rezen: MorningTickResult["rezen"];
}): string {
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const lines: string[] = [];
  lines.push(`*REOS Morning Brief · ${dateStr}*`);
  lines.push("");

  // Contract scan
  if (args.contractScan) {
    lines.push(
      `📥 *Inbox*: scanned ${args.contractScan.scanned} threads · ${args.contractScan.hits} new contract candidate(s) extracted`,
    );
  } else {
    lines.push("📥 *Inbox*: skipped (Gmail not connected)");
  }

  // Auto-link senders → participants
  if (args.autoLink && args.autoLink.participantsAdded > 0) {
    lines.push(
      `🔗 *Auto-linked*: ${args.autoLink.participantsAdded} new participant(s) added (${args.autoLink.sendersScanned} senders across ${args.autoLink.dealsScanned} deals)`,
    );
  }

  // Earnest money scan
  if (args.earnestMoneyScan) {
    lines.push(
      `💰 *Earnest money*: ${args.earnestMoneyScan.completed} EM milestone(s) auto-completed across ${args.earnestMoneyScan.scanned} deal(s)`,
    );
  }

  // Classification
  lines.push(
    `🤖 *AI sort*: ${args.classification.classified} doc(s) placed · ${args.classification.nullified} unrelated · ${args.classification.errored} errored`,
  );

  lines.push("");
  // Rezen status
  lines.push(
    `📋 *Rezen prep*: ${args.rezen.readyToPush}/${args.rezen.activeDeals} deals ready to push · ${args.rezen.missingRequired} still need files`,
  );
  if (args.rezen.bestGap.length > 0) {
    lines.push("");
    lines.push("*Top gaps:*");
    for (const g of args.rezen.bestGap) {
      lines.push(`• _${escapeMd(g.address)}_`);
      for (const m of g.missing.slice(0, 3)) {
        lines.push(`   — ${escapeMd(m)}`);
      }
    }
  } else if (args.rezen.activeDeals > 0) {
    lines.push("");
    lines.push("✅ Every active deal has its required Rezen docs.");
  }

  lines.push("");
  lines.push(`_Run finished ${new Date().toLocaleTimeString("en-US")}_`);
  return lines.join("\n");
}

/** Escape Markdown-special chars in dynamic content. */
function escapeMd(s: string): string {
  return s.replace(/([_*[\]()`])/g, "\\$1");
}
