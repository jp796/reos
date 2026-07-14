/**
 * TransactionNoteComms — one place that fans a transaction note out to
 * teammates (Telegram + email) AND records a reply-thread for each Telegram
 * message, so a teammate can just REPLY to the ping and their reply posts back
 * as a note on the correct deal (see the Telegram webhook).
 *
 * Shared by the in-app @mention path and the Telegram reply path, so a
 * conversation started in either place keeps threading.
 */

import type { PrismaClient } from "@prisma/client";
import { TelegramService } from "@/services/integrations/TelegramService";
import { sendAccountGmail } from "@/services/integrations/GmailSendService";

export interface NoteRecipient {
  id: string;
  email: string;
  telegramChatId: string | null;
}

const REPLY_HINT = "↩️ Reply to this message to post straight back to the deal.";

/** Build the notification body shown on Telegram + email. Exposed for tests. */
export function buildNoteMessage(args: {
  fromName: string;
  property: string;
  body: string;
  dealUrl: string;
}): string {
  return `${args.fromName} on ${args.property}:\n\n${args.body}\n\n${REPLY_HINT}\n${args.dealUrl}`;
}

/**
 * Notify `recipients` of a note on a deal. Each Telegram send records a
 * (chatId, messageId) → transaction thread so replies round-trip. Best-effort:
 * a failed send/record never throws.
 */
export async function notifyTeammatesOfNote(
  db: PrismaClient,
  args: {
    accountId: string;
    transactionId: string;
    property: string;
    body: string;
    fromName: string;
    fromEmail: string;
    recipients: NoteRecipient[];
  },
): Promise<void> {
  const { accountId, transactionId, property, body, fromName, fromEmail, recipients } = args;
  if (recipients.length === 0) return;

  const dealUrl = `https://www.myrealestateos.com/transactions/${transactionId}`;
  const text = buildNoteMessage({ fromName, property, body, dealUrl });

  if (TelegramService.isConfigured()) {
    await Promise.all(
      recipients
        .filter((r) => r.telegramChatId)
        .map(async (r) => {
          try {
            const tg = new TelegramService();
            const messageId = await tg.sendMessage(text, { chatId: r.telegramChatId! });
            if (messageId != null) {
              await db.telegramNoteThread
                .create({
                  data: {
                    accountId,
                    transactionId,
                    chatId: r.telegramChatId!,
                    messageId: String(messageId),
                  },
                })
                .catch(() => {});
            }
          } catch {
            /* one recipient failing never blocks the rest */
          }
        }),
    );
  }

  const emails = recipients.map((r) => r.email).filter(Boolean);
  if (emails.length > 0) {
    await sendAccountGmail({
      accountId,
      fromEmail,
      recipients: emails,
      subject: `Note on ${property}`,
      text,
    }).catch(() => {});
  }
}
