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

  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REDIRECT_URI
  )
    return;

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

  const subject = `Note: ${property}`;
  const fromName = actor.name ?? actor.email;
  const text = `${fromName} added a note on ${property}:\n\n${noteBody}\n\n— Sent from REOS`;

  const lines = [
    `From: ${actor.email}`,
    `To: ${shareList.join(", ")}`,
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

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}
