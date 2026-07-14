/**
 * DealSpaceService — each deal's Telegram Forum Topic (its "Space"), the
 * per-deal equivalent of a Google Chat Space.
 *
 * The account's forum supergroup (Account.telegramForumChatId) is the team
 * space; every transaction gets one Topic inside it, created lazily on the
 * first deal notification. Deal notes post into that topic and replies there
 * thread back to the deal — so the conversation lives in a browsable, per-deal
 * channel instead of one continuous stream.
 */

import type { PrismaClient } from "@prisma/client";
import { TelegramService } from "@/services/integrations/TelegramService";

export interface DealSpace {
  forumChatId: string;
  topicId: string;
}

/**
 * Ensure this deal has a Topic in its account's forum group. Returns the
 * {forumChatId, topicId} to post into, or null when the account hasn't set up
 * a forum space yet (caller falls back to per-user DMs).
 */
export async function ensureDealSpace(
  db: PrismaClient,
  transactionId: string,
): Promise<DealSpace | null> {
  const txn = await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      telegramTopicId: true,
      propertyAddress: true,
      contact: { select: { fullName: true } },
      account: { select: { telegramForumChatId: true } },
    },
  });
  const forumChatId = txn?.account?.telegramForumChatId ?? null;
  if (!txn || !forumChatId) return null;

  if (txn.telegramTopicId) {
    return { forumChatId, topicId: txn.telegramTopicId };
  }

  const name = (txn.propertyAddress || txn.contact?.fullName || "New deal").slice(0, 128);
  const topicId = await new TelegramService().createForumTopic(forumChatId, name);
  if (topicId == null) return null;

  await db.transaction.update({
    where: { id: transactionId },
    data: { telegramTopicId: String(topicId) },
  });
  return { forumChatId, topicId: String(topicId) };
}

/**
 * Post a note into a deal's Telegram Space (Forum Topic). Returns true if it
 * was posted (a space exists + send succeeded); false when there's no space
 * configured, so the caller can fall back to @mention DMs.
 */
export async function postNoteToDealSpace(
  db: PrismaClient,
  transactionId: string,
  fromName: string,
  body: string,
): Promise<boolean> {
  if (!TelegramService.isConfigured()) return false;
  const space = await ensureDealSpace(db, transactionId);
  if (!space) return false;
  try {
    await new TelegramService().sendMessage(`💬 ${fromName}:\n${body}`, {
      chatId: space.forumChatId,
      messageThreadId: space.topicId,
      parseMode: "HTML",
    });
    return true;
  } catch {
    return false;
  }
}

/** Find the deal whose Topic a forum message belongs to (for routing replies
 *  in a topic back to the right deal's notes). */
export async function dealForTopic(
  db: PrismaClient,
  forumChatId: string,
  topicId: string | number,
): Promise<{ id: string; accountId: string; propertyAddress: string | null } | null> {
  return db.transaction.findFirst({
    where: {
      telegramTopicId: String(topicId),
      account: { telegramForumChatId: forumChatId },
    },
    select: { id: true, accountId: true, propertyAddress: true },
  });
}
