/**
 * Per-user Telegram linking.
 *
 *   GET    — current link status for the signed-in user + (if not yet
 *            linked) a fresh deep link to start the bot.
 *   POST   — (re)generate a one-time link code and return the t.me
 *            deep link. Opening it sends "/start <code>" to the bot,
 *            which the webhook consumes to bind this user's chat.
 *   DELETE — unlink (clears chat id + code).
 *
 * Per-user, not owner-gated: any signed-in teammate can connect their
 * own Atlas-by-text channel.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { TelegramService } from "@/services/integrations/TelegramService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

async function deepLink(code: string): Promise<string | null> {
  const username = await new TelegramService().getBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?start=${code}`;
}

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { telegramChatId: true, telegramLinkCode: true, telegramLinkedAt: true },
  });

  const linked = !!user?.telegramChatId;
  return NextResponse.json({
    ok: true,
    configured: TelegramService.isConfigured(),
    linked,
    linkedAt: user?.telegramLinkedAt?.toISOString() ?? null,
    // Surface a deep link if a code is already pending (so a refresh
    // doesn't lose it); otherwise the client calls POST to mint one.
    deepLink:
      !linked && user?.telegramLinkCode
        ? await deepLink(user.telegramLinkCode)
        : null,
  });
}

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  if (!TelegramService.isConfigured()) {
    return NextResponse.json(
      { error: "Telegram isn't configured on this workspace yet." },
      { status: 400 },
    );
  }

  const code = randomBytes(9).toString("base64url"); // ~12 url-safe chars
  try {
    await prisma.user.update({
      where: { id: actor.userId },
      data: { telegramLinkCode: code },
    });
  } catch (e) {
    logError(e, { route: "POST /api/integrations/telegram/link", userId: actor.userId });
    return NextResponse.json({ error: "couldn't start linking" }, { status: 500 });
  }

  const link = await deepLink(code);
  if (!link) {
    return NextResponse.json(
      { error: "Couldn't reach the Telegram bot. Try again shortly." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, deepLink: link, code });
}

export async function DELETE() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  await prisma.user.update({
    where: { id: actor.userId },
    data: { telegramChatId: null, telegramLinkCode: null, telegramLinkedAt: null },
  });
  return NextResponse.json({ ok: true });
}
