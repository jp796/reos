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
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { askAtlas } from "@/services/ai/AtlasChatService";
import { executeTool, type AtlasActor } from "@/services/ai/AtlasTools";
import { TelegramService } from "@/services/integrations/TelegramService";
import { logError } from "@/lib/log";

const YES = new Set(["yes", "y", "yep", "yeah", "confirm", "ok", "okay", "do it", "go", "proceed", "sure", "yes please"]);
const NO = new Set(["no", "n", "nope", "cancel", "stop", "nvm", "never mind"]);

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

  // 3. Resolve the acting user. Telegram is the owner's private channel,
  //    so the agent acts AS the primary allowed (owner) user — inheriting
  //    their account, role, and visibility. Resolve by AUTH_ALLOWED_EMAILS
  //    (the first existing user), NOT account.findFirst() — that returns
  //    an arbitrary tenant when several accounts exist (the classic bug).
  const allowedEmails = (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let actorUser: { id: string; role: string; accountId: string | null } | null = null;
  for (const email of allowedEmails) {
    actorUser = await prisma.user.findFirst({
      where: { email },
      select: { id: true, role: true, accountId: true },
    });
    if (actorUser?.accountId) break;
    actorUser = null;
  }
  if (!actorUser || !actorUser.accountId) return NextResponse.json({ ok: true });
  const actor: AtlasActor = {
    userId: actorUser.id,
    accountId: actorUser.accountId,
    role: actorUser.role || "owner",
  };

  const tg = new TelegramService();
  const text = msg.text.trim();
  const lower = text.toLowerCase();
  const pendingKey = {
    accountId_userId_channel: {
      accountId: actor.accountId,
      userId: actor.userId,
      channel: "telegram",
    },
  };

  if (text === "/start") {
    await tg
      .sendMessage(
        "*Atlas online.*\nAsk about your deals — or tell me to DO things: _add a task to 509 Bent_, _move 3453 Willard to rehab_, _set closing on Main St to Aug 1_. I'll confirm before any change.",
      )
      .catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (text === "/help") {
    await tg
      .sendMessage(
        "*Ask*\n• what's closing this week?\n• status of 509 Bent\n\n*Do* (I confirm first)\n• add task 'call lender' to 509 Bent due friday\n• move 3453 Willard to rehab\n• set inspection on Main St to 7/20\n• note on 509 Bent: seller wants a leaseback",
      )
      .catch(() => {});
    return NextResponse.json({ ok: true });
  }

  try {
    // Confirmation of a previously-proposed write?
    const pending = await prisma.atlasPendingAction.findUnique({ where: pendingKey });
    if (pending && (YES.has(lower) || NO.has(lower))) {
      if (NO.has(lower)) {
        await prisma.atlasPendingAction.delete({ where: { id: pending.id } });
        await tg.sendMessage("Cancelled — nothing changed.").catch(() => {});
        return NextResponse.json({ ok: true });
      }
      const actions =
        (pending.actionsJson as Array<{ tool: string; args: Record<string, unknown> }>) ?? [];
      const lines: string[] = [];
      for (const a of actions) {
        const r = await executeTool(prisma, actor, a.tool, a.args);
        lines.push(r.ok ? `✅ ${r.summary}` : `⚠️ ${r.error}`);
      }
      await prisma.atlasPendingAction.delete({ where: { id: pending.id } });
      await tg.sendMessage((lines.join("\n") || "Done.").slice(0, 3900)).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    const reply = await askAtlas(prisma, actor, text);
    if (reply.proposedActions.length > 0) {
      await prisma.atlasPendingAction.upsert({
        where: pendingKey,
        create: {
          accountId: actor.accountId,
          userId: actor.userId,
          channel: "telegram",
          actionsJson: reply.proposedActions as unknown as Prisma.InputJsonValue,
          summary: reply.text.slice(0, 200),
        },
        update: {
          actionsJson: reply.proposedActions as unknown as Prisma.InputJsonValue,
          summary: reply.text.slice(0, 200),
        },
      });
      const previews = reply.proposedActions.map((a, i) => `${i + 1}. ${a.preview}`).join("\n");
      await tg
        .sendMessage(`${reply.text}\n\n${previews}\n\nReply *yes* to confirm, *no* to cancel.`.slice(0, 3900))
        .catch(() => {});
    } else {
      // No proposal this turn — clear any stale pending so a later "yes"
      // can't fire an old action.
      await prisma.atlasPendingAction.deleteMany({
        where: { accountId: actor.accountId, userId: actor.userId, channel: "telegram" },
      });
      await tg.sendMessage(reply.text.slice(0, 3900)).catch(() => {});
    }
  } catch (e) {
    logError(e, {
      route: "/api/integrations/telegram/webhook",
      meta: { chat: senderChat, text: text.slice(0, 80) },
    });
    await tg
      .sendMessage("Atlas hit an error — try again in a few seconds. (Logged.)")
      .catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
