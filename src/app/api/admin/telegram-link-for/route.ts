/**
 * POST /api/admin/telegram-link-for   (owner only)
 * Body: { email }
 *
 * Mint a Telegram connect link for a TEAMMATE, so the owner can onboard them
 * even when their own Connect button misbehaves. Returns a t.me deep link +
 * code; the teammate still completes the link themselves by opening it and
 * tapping Start (only they can bind their own phone), so this just hands them a
 * working link. The target must be a member of the owner's account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { TelegramService } from "@/services/integrations/TelegramService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }
  if (!TelegramService.isConfigured()) {
    return NextResponse.json({ error: "Telegram isn't configured yet." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, accountId: true },
  });
  if (!user) {
    return NextResponse.json({ error: `No REOS user with email ${email}` }, { status: 404 });
  }

  // The target must be on the owner's account (home) or an accepted member.
  const isHomeUser = user.accountId === actor.accountId;
  const membership = isHomeUser
    ? true
    : !!(await prisma.accountMembership.findFirst({
        where: { accountId: actor.accountId, userId: user.id, revokedAt: null },
        select: { id: true },
      }));
  if (!membership) {
    return NextResponse.json({ error: `${email} isn't a member of your workspace.` }, { status: 403 });
  }

  const code = randomBytes(9).toString("base64url");
  try {
    await prisma.user.update({ where: { id: user.id }, data: { telegramLinkCode: code } });
  } catch (e) {
    logError(e, { route: "POST /api/admin/telegram-link-for", accountId: actor.accountId });
    return NextResponse.json({ error: "couldn't mint link" }, { status: 500 });
  }

  const username = await new TelegramService().getBotUsername();
  if (!username) {
    return NextResponse.json({ error: "couldn't reach the Telegram bot" }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    name: user.name ?? email,
    deepLink: `https://t.me/${username}?start=${code}`,
    code,
  });
}
