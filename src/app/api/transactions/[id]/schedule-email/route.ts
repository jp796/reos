/**
 * POST /api/transactions/:id/schedule-email
 *
 * Queue a user-authored email to send later (Gmail-style). Stores a
 * ScheduledEmail (status pending); the hourly tick sends it once at/after
 * sendAt. The body is the SAME final to/subject/body the send flow uses —
 * the user has already reviewed it.
 *
 * Body: { to: string|string[], cc?: string[], subject, body, sendAt (ISO) }
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isDealVisible } from "@/lib/deal-visibility";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true, assignedUserId: true, restrictedToAssignee: true },
  });
  if (!txn || !isDealVisible(actor, txn)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let b: { to?: string | string[]; cc?: string[]; subject?: string; body?: string; sendAt?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const to = (Array.isArray(b.to) ? b.to : [b.to ?? ""])
    .map((s) => String(s).trim())
    .filter(Boolean);
  const cc = (Array.isArray(b.cc) ? b.cc : []).map((s) => String(s).trim()).filter(Boolean);
  if (to.length === 0 || !to.every(isEmail)) {
    return NextResponse.json({ error: "valid recipient(s) required" }, { status: 400 });
  }
  if (cc.length > 0 && !cc.every(isEmail)) {
    return NextResponse.json({ error: "invalid cc address" }, { status: 400 });
  }
  const subject = (b.subject ?? "").trim();
  const bodyText = (b.body ?? "").trim();
  if (!subject || !bodyText) {
    return NextResponse.json({ error: "subject + body required" }, { status: 400 });
  }
  const sendAt = b.sendAt ? new Date(b.sendAt) : null;
  if (!sendAt || Number.isNaN(sendAt.getTime())) {
    return NextResponse.json({ error: "valid sendAt required" }, { status: 400 });
  }
  if (sendAt.getTime() < Date.now() + 60_000) {
    return NextResponse.json({ error: "sendAt must be at least a minute in the future" }, { status: 400 });
  }

  try {
    const row = await prisma.scheduledEmail.create({
      data: {
        accountId: actor.accountId,
        transactionId: txn.id,
        createdByUserId: actor.userId,
        fromEmail: actor.email,
        toJson: to as unknown as Prisma.InputJsonValue,
        ccJson: cc.length > 0 ? (cc as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        subject,
        body: bodyText,
        sendAt,
      },
      select: { id: true, sendAt: true },
    });
    return NextResponse.json({ ok: true, id: row.id, sendAt: row.sendAt.toISOString() });
  } catch (e) {
    logError(e, { route: "POST /api/transactions/[id]/schedule-email", transactionId: txn.id });
    return NextResponse.json({ error: "couldn't schedule" }, { status: 500 });
  }
}
