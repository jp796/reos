/**
 * GET  /api/transactions/:id/notes  — list (newest first), include
 *                                     author + read state for caller
 * POST /api/transactions/:id/notes  — create new note
 *
 * On create, the author's userId is added to readByJson so they
 * don't get a red dot on a note they just wrote. If notifyEmail is
 * true, fan the note out to the account's onboarding share-list as
 * a Gmail send.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";
import { TelegramService } from "@/services/integrations/TelegramService";

export const runtime = "nodejs";

const create = z.object({
  body: z.string().min(1).max(8000),
  notifyEmail: z.boolean().optional().default(false),
});

async function ownsTxn(txnId: string, accountId: string): Promise<boolean> {
  const t = await prisma.transaction.findUnique({
    where: { id: txnId },
    select: { accountId: true },
  });
  return !!t && t.accountId === accountId;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  if (!(await ownsTxn(id, actor.accountId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rows = await prisma.transactionNote.findMany({
    where: { transactionId: id },
    orderBy: { createdAt: "desc" },
    include: {
      author: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    notes: rows.map((r) => ({
      id: r.id,
      body: r.body,
      author: r.author
        ? {
            id: r.author.id,
            name: r.author.name,
            email: r.author.email,
            image: r.author.image,
          }
        : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      read: Array.isArray(r.readByJson)
        ? (r.readByJson as string[]).includes(actor.userId)
        : false,
    })),
    unreadCount: rows.filter((r) => {
      const arr = Array.isArray(r.readByJson) ? (r.readByJson as string[]) : [];
      return !arr.includes(actor.userId);
    }).length,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;
  if (!(await ownsTxn(id, actor.accountId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: z.infer<typeof create>;
  try {
    body = create.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  try {
    const note = await prisma.transactionNote.create({
      data: {
        transactionId: id,
        authorUserId: actor.userId,
        body: body.body.trim(),
        // Author always reads their own note
        readByJson: [actor.userId],
        notifyEmail: body.notifyEmail,
      },
    });

    // Optional: fan the new note out to the share-list as a Gmail
    // notification. Best-effort — failures don't block the note save.
    if (body.notifyEmail) {
      try {
        await sendShareListNotification(actor.accountId, id, body.body, actor);
      } catch (e) {
        logError(e, {
          route: "POST /api/transactions/[id]/notes",
          accountId: actor.accountId,
          transactionId: id,
        });
      }
    }

    // Team chat: @mentions always notify the mentioned teammate directly —
    // Telegram (instant) + email — so the conversation on the deal replaces
    // scattered Google Chat. Best-effort; never blocks the post.
    try {
      await notifyMentions(actor.accountId, id, body.body, actor);
    } catch (e) {
      logError(e, {
        route: "POST /api/transactions/[id]/notes#mentions",
        accountId: actor.accountId,
        transactionId: id,
      });
    }

    return NextResponse.json({ ok: true, note });
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/notes",
      accountId: actor.accountId,
      transactionId: id,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: 500 },
    );
  }
}

/**
 * Parse @mentions from a note and notify each mentioned teammate directly.
 * A mention matches a team member by "@FirstName", "@Full Name", or
 * "@email-local-part". The author never notifies themselves. Each mentioned
 * teammate gets an instant Telegram ping (if linked) + an email — so the deal
 * thread is a real team chat, not scattered across Google Chat.
 */
async function notifyMentions(
  accountId: string,
  transactionId: string,
  noteBody: string,
  actor: { userId: string; name: string | null; email: string },
): Promise<void> {
  // No @ at all → nothing to do (keeps the common case free).
  if (!noteBody.includes("@")) return;

  const team = await prisma.user.findMany({
    where: { accountId, id: { not: actor.userId } },
    select: { id: true, name: true, email: true, telegramChatId: true },
  });
  if (team.length === 0) return;

  const lower = noteBody.toLowerCase();
  const mentioned = team.filter((u) => {
    const tokens = new Set<string>();
    if (u.name) {
      tokens.add(u.name.toLowerCase());
      const first = u.name.split(/\s+/)[0]?.toLowerCase();
      if (first) tokens.add(first);
    }
    const local = u.email.split("@")[0]?.toLowerCase();
    if (local) tokens.add(local);
    return [...tokens].some((t) => t && lower.includes(`@${t}`));
  });
  if (mentioned.length === 0) return;

  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { propertyAddress: true },
  });
  const property = txn?.propertyAddress ?? "a deal";
  const fromName = actor.name ?? actor.email;
  const dealUrl = `https://www.myrealestateos.com/transactions/${transactionId}`;
  const text = `${fromName} mentioned you on ${property}:\n\n${noteBody}\n\n${dealUrl}`;

  // Telegram — instant, per-user. Best-effort per recipient.
  if (TelegramService.isConfigured()) {
    const tg = new TelegramService();
    await Promise.all(
      mentioned
        .filter((u) => u.telegramChatId)
        .map((u) =>
          tg.sendMessage(text, { chatId: u.telegramChatId! }).catch(() => {}),
        ),
    );
  }

  // Email — to the mentioned teammates, via the account's connected Gmail.
  const emails = mentioned.map((u) => u.email).filter(Boolean);
  if (emails.length > 0) {
    await sendGmailFromActor(
      accountId,
      actor,
      emails,
      `You were mentioned: ${property}`,
      text,
    ).catch(() => {});
  }
}

/** Sends a transactional email to the onboarding share-list when a
 * note is posted with notifyEmail=true. Uses the user's connected
 * Gmail (no separate transactional ESP needed). */
async function sendShareListNotification(
  accountId: string,
  transactionId: string,
  noteBody: string,
  actor: { name: string | null; email: string },
): Promise<void> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      googleOauthTokensEncrypted: true,
      settingsJson: true,
    },
  });
  if (!account?.googleOauthTokensEncrypted) return;

  const onboarding =
    (account.settingsJson as Record<string, unknown> | null)?.onboarding as
      | Record<string, unknown>
      | undefined;
  const shareList = Array.isArray(onboarding?.calendarShareList)
    ? (onboarding!.calendarShareList as unknown[]).filter(
        (e): e is string => typeof e === "string",
      )
    : [];
  if (shareList.length === 0) return;

  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { propertyAddress: true },
  });
  const property = txn?.propertyAddress ?? "transaction";

  const subject = `Note: ${property}`;
  const fromName = actor.name ?? actor.email;
  const text = `${fromName} added a note on ${property}:\n\n${noteBody}\n\n— Sent from REOS`;
  await sendGmailFromActor(accountId, actor, shareList, subject, text);
}

/** Send a plain-text email from the account's connected Gmail to `recipients`.
 *  Shared by the share-list fan-out and @mention notifications. No-ops when
 *  Gmail isn't connected or OAuth env is missing. */
async function sendGmailFromActor(
  accountId: string,
  actor: { email: string },
  recipients: string[],
  subject: string,
  text: string,
): Promise<void> {
  if (recipients.length === 0) return;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return;
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { googleOauthTokensEncrypted: true },
  });
  if (!account?.googleOauthTokensEncrypted) return;

  const { GoogleOAuthService, DEFAULT_SCOPES } = await import(
    "@/services/integrations/GoogleOAuthService"
  );
  const { getEncryptionService } = await import("@/lib/encryption");
  const { google } = await import("googleapis");

  const oauth = new GoogleOAuthService(
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
      scopes: DEFAULT_SCOPES,
    },
    prisma,
    getEncryptionService(),
  );
  const auth = await oauth.createAuthenticatedClient(accountId);
  const gmail = google.gmail({ version: "v1", auth });

  const lines = [
    `From: ${actor.email}`,
    `To: ${recipients.join(", ")}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    text,
  ].join("\r\n");

  const raw = Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}
