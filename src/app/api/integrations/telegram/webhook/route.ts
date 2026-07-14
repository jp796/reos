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
import { executeTool, previewAction, type AtlasActor } from "@/services/ai/AtlasTools";
import {
  ContractExtractionService,
  type ContractExtraction,
} from "@/services/ai/ContractExtractionService";
import type { DealFields } from "@/services/core/createDealFromExtraction";
import { TelegramService } from "@/services/integrations/TelegramService";
import { notifyTeammatesOfNote } from "@/services/integrations/TransactionNoteComms";
import { resolveAccountTeam } from "@/services/automation/TaskReminderService";
import { logError } from "@/lib/log";

type PendingKey = {
  accountId_userId_channel: { accountId: string; userId: string; channel: string };
};

/** ContractExtraction (field-wrapped) → flat DealFields for create_deal. */
function fieldsFromExtraction(ex: ContractExtraction): DealFields {
  const val = <T,>(f?: { value: T | null }): T | undefined =>
    f && f.value != null ? f.value : undefined;
  const first = (f?: { value: string[] | null }): string | undefined =>
    f && Array.isArray(f.value) && f.value.length > 0 ? f.value[0] : undefined;
  return {
    address: val(ex.propertyAddress) ?? "",
    buyerName: first(ex.buyers) ?? null,
    sellerName: first(ex.sellers) ?? null,
    effectiveDate: val(ex.effectiveDate) ?? null,
    closingDate: val(ex.closingDate) ?? null,
    possessionDate: val(ex.possessionDate) ?? null,
    inspectionDeadline: val(ex.inspectionDeadline) ?? null,
    inspectionObjectionDeadline: val(ex.inspectionObjectionDeadline) ?? null,
    titleCommitmentDeadline: val(ex.titleCommitmentDeadline) ?? null,
    titleObjectionDeadline: val(ex.titleObjectionDeadline) ?? null,
    financingDeadline: val(ex.financingDeadline) ?? null,
    walkthroughDate: val(ex.walkthroughDate) ?? null,
    earnestMoneyDueDate: val(ex.earnestMoneyDueDate) ?? null,
    earnestMoneyAmount: val(ex.earnestMoneyAmount) ?? null,
    purchasePrice: val(ex.purchasePrice) ?? null,
    sellerSideCommissionPct: val(ex.sellerSideCommissionPct) ?? null,
    sellerSideCommissionAmount: val(ex.sellerSideCommissionAmount) ?? null,
    buyerSideCommissionPct: val(ex.buyerSideCommissionPct) ?? null,
    buyerSideCommissionAmount: val(ex.buyerSideCommissionAmount) ?? null,
    titleCompany: val(ex.titleCompanyName) ?? null,
    lenderName: val(ex.lenderName) ?? null,
    contractStage: val(ex.contractStage) ?? null,
    source: "Contract upload (Telegram)",
  };
}

/**
 * Parse a deal-type instruction from the message caption, e.g. sending a
 * contract with the caption "flip" or "sub-to". Wins over auto-classify.
 */
function parseDealTypeInstruction(
  caption: string | undefined,
): { strategy: string; sub?: string; label: string } | null {
  const c = (caption ?? "").toLowerCase();
  if (!c.trim()) return null;
  if (/\bsub[\s-]?2\b|\bsubject[\s-]?to\b/.test(c)) return { strategy: "creative", sub: "subject_to", label: "creative · subject-to" };
  if (/owner\s?carry|seller\s?financ/.test(c)) return { strategy: "creative", sub: "seller_finance", label: "creative · owner carry" };
  if (/lease\s?option/.test(c)) return { strategy: "creative", sub: "lease_option", label: "creative · lease option" };
  if (/\bcreative\b/.test(c)) return { strategy: "creative", label: "creative finance" };
  if (/wholesale|assign/.test(c)) return { strategy: "wholesale", label: "wholesale" };
  if (/\bflip\b/.test(c)) return { strategy: "flip", label: "flip" };
  if (/rental|brrrr|buy.?and.?hold|\bhold\b/.test(c)) return { strategy: "rental_brrrr", label: "rental / BRRRR" };
  if (/retail|\bagency\b/.test(c)) return { strategy: "retail", label: "retail" };
  return null;
}

/**
 * Upload → create a deal. The user sends a contract PDF (document) or
 * photo(s) of one. We download → extract via GPT (text for PDF, vision
 * for image) → map to DealFields → PROPOSE create_deal, held under the
 * pending key for a "yes". Never writes directly: confirm-before-write.
 * The caption can carry a deal-type instruction ("flip", "sub-to", …).
 */
async function handleUpload(
  actor: AtlasActor,
  tg: TelegramService,
  msg: TgMessage,
  pendingKey: PendingKey,
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await tg.sendMessage("Contract reading isn't configured yet (no OpenAI key).").catch(() => {});
    return;
  }

  const isPdf =
    !!msg.document &&
    (msg.document.mime_type === "application/pdf" ||
      (msg.document.file_name ?? "").toLowerCase().endsWith(".pdf"));
  const photo =
    msg.photo && msg.photo.length > 0 ? msg.photo[msg.photo.length - 1] : null; // largest size

  const svc = new ContractExtractionService(apiKey);
  let ex: ContractExtraction;

  if (msg.document && isPdf) {
    await tg.sendMessage("📄 Got it — reading the contract…").catch(() => {});
    const buf = await tg.downloadFile(msg.document.file_id);
    ex = await svc.extract(buf);
  } else if (msg.document && !isPdf) {
    await tg
      .sendMessage("That file isn't a PDF. Send the signed contract as a PDF, or a clear photo of it.")
      .catch(() => {});
    return;
  } else if (photo) {
    await tg.sendMessage("🖼️ Got it — reading the photo…").catch(() => {});
    const buf = await tg.downloadFile(photo.file_id);
    ex = await svc.extractFromImages([buf]);
  } else {
    await tg.sendMessage("I didn't find a file to read.").catch(() => {});
    return;
  }

  const fields = fieldsFromExtraction(ex);
  // Deal-type instruction from the caption (e.g. "flip", "sub-to").
  const dealType = parseDealTypeInstruction(msg.caption);
  if (dealType) {
    fields.strategyOverride = dealType.strategy;
    fields.creativeSubstructureOverride = dealType.sub ?? null;
  }
  if (!fields.address || !fields.address.trim()) {
    await tg
      .sendMessage(
        "I read the file but couldn't find a property address. Send a clearer copy, or just tell me the address and details to create it.",
      )
      .catch(() => {});
    return;
  }

  const action = {
    tool: "create_deal",
    args: fields as unknown as Record<string, unknown>,
    preview: previewAction("create_deal", fields as unknown as Record<string, unknown>),
  };
  await prisma.atlasPendingAction.upsert({
    where: pendingKey,
    create: {
      accountId: actor.accountId,
      userId: actor.userId,
      channel: "telegram",
      actionsJson: [action] as unknown as Prisma.InputJsonValue,
      summary: `create ${fields.address}`.slice(0, 200),
    },
    update: {
      actionsJson: [action] as unknown as Prisma.InputJsonValue,
      summary: `create ${fields.address}`.slice(0, 200),
    },
  });

  const fmtMoney = (n?: number | null) =>
    typeof n === "number" ? `$${Math.round(n).toLocaleString()}` : null;
  const lines = [
    "*New deal from contract*",
    `📍 ${fields.address}`,
    dealType ? `Type: ${dealType.label}` : null,
    fields.buyerName ? `Buyer: ${fields.buyerName}` : null,
    fields.sellerName ? `Seller: ${fields.sellerName}` : null,
    fmtMoney(fields.purchasePrice) ? `Price: ${fmtMoney(fields.purchasePrice)}` : null,
    fields.closingDate ? `Closing: ${fields.closingDate}` : null,
    fields.inspectionDeadline ? `Inspection: ${fields.inspectionDeadline}` : null,
    "",
    "Reply *yes* to create it, *no* to discard.",
  ]
    .filter(Boolean)
    .join("\n");
  await tg.sendMessage(lines.slice(0, 3900)).catch(() => {});
}

const YES = new Set(["yes", "y", "yep", "yeah", "confirm", "ok", "okay", "do it", "go", "proceed", "sure", "yes please"]);
const NO = new Set(["no", "n", "nope", "cancel", "stop", "nvm", "never mind"]);

export const runtime = "nodejs";
export const maxDuration = 60;

interface TgFile {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}
interface TgPhoto {
  file_id: string;
  file_size?: number;
  width?: number;
}
interface TgMessage {
  message_id?: number;
  chat: { id: number; type?: string };
  from?: { id?: number };
  message_thread_id?: number;
  text?: string;
  caption?: string;
  document?: TgFile;
  photo?: TgPhoto[];
  reply_to_message?: { message_id?: number };
}
interface TgUpdate {
  message?: TgMessage;
  edited_message?: TgMessage;
}

/**
 * Forum-group handling (per-deal Spaces). Two jobs:
 *   1. `/here` (or `/setspace`) binds this supergroup as the account's deal
 *      space — the bot then creates one Topic per deal.
 *   2. A message posted inside a deal's Topic is saved back to that deal's
 *      notes, so the conversation stays in sync with REOS. Silent (no reply)
 *      to avoid noise — the message is already visible in the topic.
 */
async function handleForumMessage(
  msg: TgMessage,
  senderChat: string,
  rawText: string,
): Promise<void> {
  const fromId = msg.from?.id != null ? String(msg.from.id) : null;
  let actorUser = fromId
    ? await prisma.user.findFirst({
        where: { telegramChatId: fromId },
        select: { id: true, accountId: true },
      })
    : null;

  // Legacy fallback: a private chat's id equals the user's Telegram id, so an
  // owner who linked via the shared env chat (TELEGRAM_CHAT_ID) is recognized
  // in a group by matching from.id — no need to re-link personally first.
  if (!actorUser && fromId) {
    const envChat = (env.TELEGRAM_CHAT_ID ?? "").trim();
    if (envChat && envChat !== "unset" && fromId === envChat) {
      const allowedEmails = (process.env.AUTH_ALLOWED_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      for (const email of allowedEmails) {
        const u = await prisma.user.findFirst({
          where: { email },
          select: { id: true, accountId: true },
        });
        if (u?.accountId) {
          actorUser = u;
          break;
        }
      }
    }
  }

  // Bind this group as the account's deal space.
  if (/^\/(here|setspace)\b/i.test(rawText)) {
    const groupTg = new TelegramService(senderChat);
    if (!actorUser?.accountId) {
      await groupTg
        .sendMessage(
          "I don't know who you are yet. DM me and connect via *Settings → Notifications → Connect Telegram*, then run /here in this group.",
        )
        .catch(() => {});
      return;
    }
    await prisma.account.update({
      where: { id: actorUser.accountId },
      data: { telegramForumChatId: senderChat },
    });
    await groupTg
      .sendMessage(
        "✅ *This group is now your REOS deal space.* Each deal gets its own Topic — post a note on a deal in REOS to open its topic, and reply in a topic to post straight back to that deal's notes.",
      )
      .catch(() => {});
    return;
  }

  // A message in a deal's Topic → save it as a note on that deal.
  const threadId = msg.message_thread_id;
  if (threadId != null && rawText && !rawText.startsWith("/") && actorUser?.id) {
    const { dealForTopic } = await import("@/services/integrations/DealSpaceService");
    const deal = await dealForTopic(prisma, senderChat, threadId);
    if (deal) {
      await prisma.transactionNote.create({
        data: {
          transactionId: deal.id,
          authorUserId: actorUser.id,
          body: rawText.slice(0, 8000),
          readByJson: [actorUser.id],
        },
      });
    }
  }
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
  if (!msg) return NextResponse.json({ ok: true });

  // 2. Identify the sender's chat. The webhook secret already proved
  //    this call is from Telegram; per-user *linking* (not a single
  //    hardcoded chat) decides whose account a message acts on.
  const senderChat = String(msg.chat?.id ?? "");
  const tg = new TelegramService(senderChat);
  const rawText = (msg.text ?? "").trim();

  // 1b. Forum group (per-deal Spaces). Group messages have a supergroup chat
  //     and, for topic posts, a message_thread_id. Handle binding (/here) and
  //     topic-reply → note here, then stop (group traffic never hits the DM /
  //     Atlas-chat flow below).
  if (msg.chat?.type === "supergroup" || msg.chat?.type === "group") {
    try {
      await handleForumMessage(msg, senderChat, rawText);
    } catch (e) {
      logError(e, { route: "/api/integrations/telegram/webhook", meta: { kind: "forum" } });
    }
    return NextResponse.json({ ok: true });
  }

  // 2a. Account linking. A deep link (t.me/<bot>?start=<code>) arrives
  //     as "/start <code>". Bind this chat to the user who minted the
  //     code so they can then talk to Atlas as themselves.
  if (rawText.startsWith("/start")) {
    const code = rawText.slice("/start".length).trim();
    if (code) {
      const target = await prisma.user.findUnique({
        where: { telegramLinkCode: code },
        select: { id: true, name: true },
      });
      if (target) {
        try {
          await prisma.user.update({
            where: { id: target.id },
            data: {
              telegramChatId: senderChat,
              telegramLinkCode: null,
              telegramLinkedAt: new Date(),
            },
          });
          await tg
            .sendMessage(
              `✅ *Linked!* Hi ${target.name ?? "there"} — I'm Atlas. Ask about your deals, or tell me to add a task, move a stage, or set a deadline. I confirm before any change.`,
            )
            .catch(() => {});
        } catch (e) {
          logError(e, { route: "/api/integrations/telegram/webhook", meta: { kind: "link" } });
          await tg
            .sendMessage("Couldn't finish linking — get a fresh link in REOS (Settings → Notifications → Connect Telegram).")
            .catch(() => {});
        }
        return NextResponse.json({ ok: true });
      }
      await tg
        .sendMessage("That link expired or was already used. In REOS open Settings → Notifications → Connect Telegram for a fresh one.")
        .catch(() => {});
      return NextResponse.json({ ok: true });
    }
    // bare /start — fall through; resolution below greets a linked user
    // or prompts an unlinked one to connect.
  }

  // 3. Resolve the acting user from the linked chat. Fall back to the
  //    legacy env chat (AUTH_ALLOWED_EMAILS owner) so JP's existing
  //    channel keeps working before he links his own. Acts in the
  //    user's HOME account with their home role.
  let actorUser:
    | { id: string; role: string; accountId: string | null }
    | null = await prisma.user.findFirst({
    where: { telegramChatId: senderChat },
    select: { id: true, role: true, accountId: true },
  });
  if (!actorUser) {
    const envChat = (env.TELEGRAM_CHAT_ID ?? "").trim();
    if (envChat && envChat !== "unset" && senderChat === envChat) {
      const allowedEmails = (process.env.AUTH_ALLOWED_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      for (const email of allowedEmails) {
        const u = await prisma.user.findFirst({
          where: { email },
          select: { id: true, role: true, accountId: true },
        });
        if (u?.accountId) {
          actorUser = u;
          break;
        }
      }
    }
  }
  if (!actorUser || !actorUser.accountId) {
    await tg
      .sendMessage("Your Telegram isn't linked to a REOS account yet. In REOS open *Settings → Notifications → Connect Telegram* to link it.")
      .catch(() => {});
    return NextResponse.json({ ok: true });
  }
  const actor: AtlasActor = {
    userId: actorUser.id,
    accountId: actorUser.accountId,
    role: actorUser.role || "owner",
  };

  // Deal-note reply: if this message REPLIES to a note ping we sent, post the
  // reply straight back to that deal's notes and re-notify the team — this is
  // what makes a Telegram ping round-trip into the right transaction.
  if (msg.reply_to_message?.message_id != null && rawText) {
    const thread = await prisma.telegramNoteThread.findFirst({
      where: { chatId: senderChat, messageId: String(msg.reply_to_message.message_id) },
    });
    if (thread) {
      try {
        const txn = await prisma.transaction.findUnique({
          where: { id: thread.transactionId },
          select: { propertyAddress: true },
        });
        if (!txn) {
          await tg.sendMessage("That deal isn't available anymore.").catch(() => {});
          return NextResponse.json({ ok: true });
        }
        await prisma.transactionNote.create({
          data: {
            transactionId: thread.transactionId,
            authorUserId: actor.userId,
            body: rawText,
            readByJson: [actor.userId],
          },
        });
        const author = await prisma.user.findUnique({
          where: { id: actor.userId },
          select: { name: true, email: true },
        });
        const team = (await resolveAccountTeam(prisma, thread.accountId)).filter(
          (u) => u.id !== actor.userId,
        );
        await notifyTeammatesOfNote(prisma, {
          accountId: thread.accountId,
          transactionId: thread.transactionId,
          property: txn.propertyAddress ?? "a deal",
          body: rawText,
          fromName: author?.name ?? "A teammate",
          fromEmail: author?.email ?? "",
          recipients: team.map((u) => ({
            id: u.id,
            email: u.email,
            telegramChatId: u.telegramChatId,
          })),
        });
        await tg
          .sendMessage(`✅ Posted to *${txn.propertyAddress ?? "the deal"}* — team notified. Reply again to keep the thread going.`)
          .catch(() => {});
      } catch (e) {
        logError(e, {
          route: "/api/integrations/telegram/webhook",
          meta: { kind: "note-reply", chat: senderChat },
        });
        await tg
          .sendMessage("Couldn't post that to the deal — try again, or add it in REOS.")
          .catch(() => {});
      }
      return NextResponse.json({ ok: true });
    }
    // No matching thread → fall through to normal Atlas chat below.
  }

  const pendingKey = {
    accountId_userId_channel: {
      accountId: actor.accountId,
      userId: actor.userId,
      channel: "telegram",
    },
  };

  // Upload → create a deal. A contract PDF (document) or photo(s) of a
  // contract: download → extract → PROPOSE create_deal, held for "yes".
  if (msg.document || (msg.photo && msg.photo.length > 0)) {
    try {
      await handleUpload(actor, tg, msg, pendingKey);
    } catch (e) {
      logError(e, { route: "/api/integrations/telegram/webhook", meta: { kind: "upload", chat: senderChat } });
      await tg.sendMessage("I couldn't process that file — try a clear PDF of the signed contract. (Logged.)").catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  const text = rawText;
  if (!text) return NextResponse.json({ ok: true });
  const lower = text.toLowerCase();

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
