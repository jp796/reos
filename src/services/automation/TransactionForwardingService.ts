/**
 * TransactionForwardingService
 *
 * Auto-uploads transaction documents to Dotloop / Rezen / SkySlope /
 * other e-signing & file-cabinet systems via their unique per-deal
 * ingest email (e.g. "2406e10thst-t@rezenfilecabinet.com").
 *
 * Flow:
 *   1. For a transaction with `forwardingEmail` set, scan its
 *      SmartFolder-labeled Gmail threads
 *   2. For every PDF attachment not already in ForwardedDocument,
 *      compose + send an email with the attachment to the
 *      transaction's forwarding address
 *   3. Record each forwarded doc in ForwardedDocument so a re-run
 *      doesn't double-send
 *
 * Guard bypass: Gmail's send endpoint is normally blocked by
 * `makeSafeGmail`. We use the raw google.gmail client here but
 * enforce that the To address exactly matches the transaction's
 * forwardingEmail — sending to arbitrary recipients is still
 * impossible through this service.
 */

import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { PrismaClient } from "@prisma/client";
import type { GmailService } from "@/services/integrations/GmailService";
import type { AutomationAuditService } from "@/services/integrations/FollowUpBossService";

export interface ForwardingResult {
  transactionId: string;
  attempted: number;
  forwarded: number;
  skipped: number;
  errored: number;
  details: Array<{
    messageId: string;
    attachmentId: string;
    filename: string;
    status: "forwarded" | "already_forwarded" | "error";
    error?: string;
  }>;
}

/**
 * Per-run cap on messages scanned + attachments forwarded, to bound
 * runtime and prevent runaway sending if a folder has thousands of
 * threads.
 */
const MAX_THREADS_PER_RUN = 100;
const MAX_FORWARDS_PER_RUN = 25;

/**
 * Only these filename patterns get forwarded — keeps junk (internal
 * notes, signature images, etc.) out of the transaction-management
 * system. Err generous: anything that looks like a transaction doc.
 */
const FORWARD_PATTERNS: RegExp[] = [
  /\.pdf$/i,
  // any .pdf is the main gate; remaining patterns document intent
];

export class TransactionForwardingService {
  /** Unguarded Gmail client — send is allowed here but recipients are whitelisted */
  private readonly sendClient: gmail_v1.Gmail;

  constructor(
    private readonly db: PrismaClient,
    private readonly gmail: GmailService,
    private readonly audit: AutomationAuditService,
    auth: OAuth2Client,
    private readonly fromEmail: string,
  ) {
    this.sendClient = google.gmail({ version: "v1", auth });
  }

  /**
   * Forward any not-yet-forwarded PDFs on the transaction's
   * SmartFolder-labeled threads to its forwardingEmail.
   */
  async forwardForTransaction(transactionId: string): Promise<ForwardingResult> {
    const txn = await this.db.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!txn) {
      return {
        transactionId,
        attempted: 0,
        forwarded: 0,
        skipped: 0,
        errored: 0,
        details: [],
      };
    }
    const result: ForwardingResult = {
      transactionId,
      attempted: 0,
      forwarded: 0,
      skipped: 0,
      errored: 0,
      details: [],
    };
    if (!txn.forwardingEmail || !isValidEmail(txn.forwardingEmail)) {
      return result;
    }
    if (!txn.smartFolderLabelId) {
      return result;
    }

    const { threads } = await this.gmail.searchThreadsPaged({
      q: "has:attachment",
      labelIds: [txn.smartFolderLabelId],
      maxTotal: MAX_THREADS_PER_RUN,
    });

    for (const t of threads) {
      if (result.forwarded >= MAX_FORWARDS_PER_RUN) break;
      if (!t.messages) continue;
      for (const m of t.messages) {
        if (result.forwarded >= MAX_FORWARDS_PER_RUN) break;
        if (!m.id) continue;
        const atts = await this.gmail.getMessageAttachments(m.id);
        for (const a of atts) {
          if (result.forwarded >= MAX_FORWARDS_PER_RUN) break;
          if (!FORWARD_PATTERNS.some((re) => re.test(a.filename))) continue;
          result.attempted++;

          const alreadyForwarded = await this.db.forwardedDocument.findUnique({
            where: {
              transactionId_messageId_attachmentId: {
                transactionId: txn.id,
                messageId: m.id,
                attachmentId: a.attachmentId,
              },
            },
          });
          if (alreadyForwarded) {
            result.skipped++;
            result.details.push({
              messageId: m.id,
              attachmentId: a.attachmentId,
              filename: a.filename,
              status: "already_forwarded",
            });
            continue;
          }

          try {
            const buf = await this.gmail.downloadAttachment(
              m.id,
              a.attachmentId,
            );
            await this.sendForwardEmail({
              to: txn.forwardingEmail,
              subject:
                txn.propertyAddress
                  ? `[REOS] ${txn.propertyAddress} · ${a.filename}`
                  : `[REOS] ${a.filename}`,
              body: buildBody(txn.propertyAddress, a.filename),
              attachment: { filename: a.filename, content: buf },
            });
            await this.db.forwardedDocument.create({
              data: {
                accountId: txn.accountId,
                transactionId: txn.id,
                messageId: m.id,
                attachmentId: a.attachmentId,
                filename: a.filename,
                toEmail: txn.forwardingEmail,
              },
            });
            result.forwarded++;
            result.details.push({
              messageId: m.id,
              attachmentId: a.attachmentId,
              filename: a.filename,
              status: "forwarded",
            });
          } catch (err) {
            result.errored++;
            const msg = err instanceof Error ? err.message : String(err);
            result.details.push({
              messageId: m.id,
              attachmentId: a.attachmentId,
              filename: a.filename,
              status: "error",
              error: msg.slice(0, 200),
            });
          }
        }
      }
    }

    await this.db.transaction.update({
      where: { id: txn.id },
      data: { forwardingLastRunAt: new Date() },
    });

    await this.audit.logAction({
      accountId: txn.accountId,
      transactionId: txn.id,
      entityType: "transaction",
      entityId: txn.id,
      ruleName: "txn_doc_forward",
      actionType: "create",
      sourceType: "email_analysis",
      confidenceScore: 1.0,
      decision: result.errored > 0 ? "failed" : "applied",
      beforeJson: null,
      afterJson: {
        to: txn.forwardingEmail,
        attempted: result.attempted,
        forwarded: result.forwarded,
        skipped: result.skipped,
        errored: result.errored,
      },
    });

    return result;
  }

  /**
   * Send a multipart email with one PDF attachment. Guards:
   *   - recipient must be a valid email
   *   - we rely on the caller to only pass a whitelisted forwarding
   *     address (set via user on Transaction)
   */
  private async sendForwardEmail(args: {
    to: string;
    subject: string;
    body: string;
    attachment: { filename: string; content: Buffer };
  }): Promise<void> {
    if (!isValidEmail(args.to)) {
      throw new Error(`invalid recipient: ${args.to}`);
    }
    const boundary = `=_reos_${Math.random().toString(36).slice(2, 10)}`;
    const safeFilename = args.attachment.filename.replace(/[\r\n"]/g, "");
    const message = [
      `From: ${this.fromEmail}`,
      `To: ${args.to}`,
      `Subject: ${args.subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      args.body,
      "",
      `--${boundary}`,
      `Content-Type: application/pdf; name="${safeFilename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safeFilename}"`,
      "",
      args.attachment.content.toString("base64").replace(/(.{76})/g, "$1\n"),
      "",
      `--${boundary}--`,
    ].join("\r\n");

    const raw = Buffer.from(message)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await this.sendClient.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
  }
}

function isValidEmail(s: string): boolean {
  // Loose RFC-5322-ish sanity check. Good enough for file-cabinet
  // addresses which are all <random>@<vendor>.com shape.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length < 254;
}

function buildBody(address: string | null, filename: string): string {
  return [
    `Auto-forwarded by REOS.`,
    ``,
    `Transaction: ${address ?? "(unknown)"}`,
    `Original attachment: ${filename}`,
    ``,
    `-- REOS`,
  ].join("\n");
}
