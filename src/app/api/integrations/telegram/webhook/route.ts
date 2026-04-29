/**
 * POST /api/integrations/telegram/webhook
 *
 * Inbound Telegram updates land here. Two-way Atlas chat: the user
 * messages @REOSAtlasBot, Telegram POSTs the update, REOS forwards
 * the text to Anthropic with the account's deal context, replies
 * via the same bot.
 *
 * Trust gate (defense in depth):
 *   1. `X-Telegram-Bot-Api-Secret-Token` header must match
 *      env.TELEGRAM_WEBHOOK_SECRET (set when registering the
 *      webhook). Telegram sends this on every call.
 *   2. The chat.id of the sender must equal env.TELEGRAM_CHAT_ID.
 *      Without this any random user who finds the bot could query
 *      Jp's deals.
 *
 * Always returns 200 to Telegram (so they don't retry) — errors are
 * swallowed and surfaced to the user as a polite reply.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { askAtlas } from "@/services/ai/AtlasChatService";
import { TelegramService } from "@/services/integrations/TelegramService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TgUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
  };
  edited_message?: {
    chat: { id: number };
    text?: string;
  };
}

export async function POST(req: NextRequest) {
  // 1. Header secret check
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expected = (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!expected || secretHeader !== expected) {
    return NextResponse.json({ ok: true }); // silent reject
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message ?? update.edited_message;
  if (!msg?.text) return NextResponse.json({ ok: true });

  // 2. Chat-id allowlist
  const allowedChat = (env.TELEGRAM_CHAT_ID ?? "").trim();
  const senderChat = String(msg.chat?.id ?? "");
  if (!allowedChat || allowedChat === "unset" || senderChat !== allowedChat) {
    // Don't reveal anything to unauthorized chats — just no-op.
    return NextResponse.json({ ok: true });
  }

  // 3. Find the (single-tenant) account to scope queries.
  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) return NextResponse.json({ ok: true });

  const tg = new TelegramService();
  const text = msg.text.trim();

  // /start, /help, /reset → quick canned replies, skip the LLM.
  if (text === "/start") {
    await tg
      .sendMessage(
        "*Atlas online.*\nAsk me anything about your active deals — closings, gaps, risks, what's overdue. Try _what's closing this week?_",
      )
      .catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (text === "/help") {
    await tg
      .sendMessage(
        "*Examples*\n• what's closing this week?\n• which deals are missing earnest money?\n• which transaction has the highest risk?\n• status of 509 Bent Avenue\n• show me the last 5 closings",
      )
      .catch(() => {});
    return NextResponse.json({ ok: true });
  }

  try {
    const reply = await askAtlas(prisma, account.id, text);
    // Telegram caps message body at 4096 chars.
    const safe = reply.text.slice(0, 3900);
    await tg.sendMessage(safe);
  } catch (e) {
    logError(e, {
      route: "/api/integrations/telegram/webhook",
      meta: { chat: senderChat, text: text.slice(0, 80) },
    });
    await tg
      .sendMessage(
        "Atlas hit an error — try again in a few seconds. (Logged.)",
      )
      .catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
