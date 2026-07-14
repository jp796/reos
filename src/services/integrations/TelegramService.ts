/**
 * TelegramService
 *
 * Minimal Telegram Bot API wrapper. Used by the morning-tick to
 * deliver Atlas's daily brief into Jp's Telegram. Pluggable so we
 * can add Slack / SMS later without touching the orchestrator.
 *
 * Setup: BotFather → /newbot → token; message the bot once → get
 * chat_id from `https://api.telegram.org/bot<TOKEN>/getUpdates`.
 * Both go in env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).
 */

import { env } from "@/lib/env";

const TG_API = "https://api.telegram.org";

export class TelegramService {
  /** Optional per-instance default chat. When set, sendMessage targets
   * this chat unless an explicit chatId is passed — lets the webhook
   * reply to whoever messaged (`new TelegramService(senderChatId)`)
   * while the morning tick (`new TelegramService()`) uses the env chat. */
  private readonly defaultChatId?: string | number;
  constructor(defaultChatId?: string | number) {
    this.defaultChatId = defaultChatId;
  }

  static isConfigured(): boolean {
    // "unset" is the placeholder we write into Secret Manager when
    // the user hasn't filled in real values yet — treat it as missing.
    const t = env.TELEGRAM_BOT_TOKEN?.trim();
    const c = env.TELEGRAM_CHAT_ID?.trim();
    return !!(t && c && t !== "unset" && c !== "unset");
  }

  /** Send a message. Defaults to the env chat (legacy single-channel
   * morning brief) but accepts an explicit `chatId` so we can reply to
   * a specific linked user's private chat. Throws on non-2xx so the
   * caller can audit. Markdown by default — readable on phone. */
  /** Send a message. Returns the Telegram message_id on success (used to
   *  thread replies back to a deal) or null if the id couldn't be read. */
  async sendMessage(
    text: string,
    opts: {
      parseMode?: "MarkdownV2" | "Markdown" | "HTML";
      disablePreview?: boolean;
      chatId?: string | number;
      /** Post into a Forum Topic (per-deal Space) within a supergroup. */
      messageThreadId?: string | number;
    } = {},
  ): Promise<number | null> {
    const chatId = opts.chatId ?? this.defaultChatId ?? env.TELEGRAM_CHAT_ID;
    if (!env.TELEGRAM_BOT_TOKEN || !chatId) {
      throw new Error(
        "Telegram not configured (TELEGRAM_BOT_TOKEN / chat id missing)",
      );
    }
    const url = `${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts.parseMode ?? "Markdown",
        disable_web_page_preview: opts.disablePreview ?? true,
        ...(opts.messageThreadId != null
          ? { message_thread_id: Number(opts.messageThreadId) }
          : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram ${res.status}: ${body.slice(0, 300)}`);
    }
    const j = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
    return j?.result?.message_id ?? null;
  }

  /**
   * Create a Forum Topic (a per-deal Space) in a supergroup. The bot must be
   * an admin there with "Manage Topics". Returns the message_thread_id, or
   * null if creation failed (e.g. not a forum, missing permission).
   */
  async createForumTopic(chatId: string | number, name: string): Promise<number | null> {
    if (!env.TELEGRAM_BOT_TOKEN) return null;
    try {
      const res = await fetch(`${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/createForumTopic`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, name: name.slice(0, 128) }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { ok: boolean; result?: { message_thread_id?: number } };
      return j.result?.message_thread_id ?? null;
    } catch {
      return null;
    }
  }

  /** The bot's @username (for building t.me deep links). Cached per
   * process. Returns null if the bot token is missing or getMe fails. */
  private static _username: string | null = null;
  async getBotUsername(): Promise<string | null> {
    if (TelegramService._username) return TelegramService._username;
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;
    try {
      const res = await fetch(`${TG_API}/bot${token}/getMe`);
      if (!res.ok) return null;
      const j = (await res.json()) as {
        ok: boolean;
        result?: { username?: string };
      };
      const u = j.result?.username ?? null;
      if (u) TelegramService._username = u;
      return u;
    } catch {
      return null;
    }
  }

  /**
   * Download a file the user sent (document or photo) by its file_id.
   * Telegram's two-step API: getFile → file_path, then fetch the binary
   * from the file endpoint. Returns the bytes as a Buffer.
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("Telegram not configured");
    const metaRes = await fetch(`${TG_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!metaRes.ok) {
      throw new Error(`Telegram getFile ${metaRes.status}: ${(await metaRes.text().catch(() => "")).slice(0, 200)}`);
    }
    const meta = (await metaRes.json()) as { ok: boolean; result?: { file_path?: string } };
    const filePath = meta.result?.file_path;
    if (!meta.ok || !filePath) throw new Error("Telegram getFile: no file_path");
    const binRes = await fetch(`${TG_API}/file/bot${token}/${filePath}`);
    if (!binRes.ok) {
      throw new Error(`Telegram file download ${binRes.status}`);
    }
    return Buffer.from(await binRes.arrayBuffer());
  }
}
