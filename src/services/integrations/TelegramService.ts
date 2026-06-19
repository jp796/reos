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
    // "unset" is the placeholder we write into Secret Manager when
    // the user hasn't filled in real values yet — treat it as missing.
    const t = env.TELEGRAM_BOT_TOKEN?.trim();
    const c = env.TELEGRAM_CHAT_ID?.trim();
    return !!(t && c && t !== "unset" && c !== "unset");
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
