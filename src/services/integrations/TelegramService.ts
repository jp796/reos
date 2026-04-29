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
  static isConfigured(): boolean {
    return !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  }

  /** Send a message to the configured chat. Throws on non-2xx so
   * the caller can audit. Markdown by default — keeps it readable
   * on phone. */
  async sendMessage(
    text: string,
    opts: { parseMode?: "MarkdownV2" | "Markdown" | "HTML"; disablePreview?: boolean } = {},
  ): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      throw new Error(
        "Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing)",
      );
    }
    const url = `${TG_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: opts.parseMode ?? "Markdown",
        disable_web_page_preview: opts.disablePreview ?? true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram ${res.status}: ${body.slice(0, 300)}`);
    }
  }
}
