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
 * Upload → create a deal. The user sends a contract PDF (document) or
 * photo(s) of one. We download → extract via GPT (text for PDF, vision
 * for image) → map to DealFields → PROPOSE create_deal, held under the
 * pending key for a "yes". Never writes directly: confirm-before-write.
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
  text?: string;
  caption?: string;
  document?: TgFile;
  photo?: TgPhoto[];
}
interface TgUpdate {
  message?: TgMessage;
  edited_message?: TgMessage;
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

  const text = (msg.text ?? "").trim();
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
