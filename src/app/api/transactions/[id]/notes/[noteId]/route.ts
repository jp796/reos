/**
 * PATCH  /api/transactions/:id/notes/:noteId — mark as read OR edit body
 * DELETE /api/transactions/:id/notes/:noteId — author only
 *
 * PATCH body:
 *   { read: true }                   — append caller's userId to readByJson
 *   { body: "..." }                  — author-only edit (resets unread state
 *                                      for everyone except the author)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

const patch = z.object({
  read: z.literal(true).optional(),
  body: z.string().min(1).max(8000).optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; noteId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id, noteId } = await ctx.params;

  const note = await prisma.transactionNote.findUnique({
    where: { id: noteId },
    include: { transaction: { select: { accountId: true } } },
  });
  if (!note || note.transactionId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (note.transaction.accountId !== actor.accountId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof patch>;
  try {
    body = patch.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  // Edit body — author only, resets read list to just the author
  if (body.body !== undefined) {
    if (note.authorUserId !== actor.userId) {
      return NextResponse.json(
        { error: "only the author can edit a note" },
        { status: 403 },
      );
    }
    const updated = await prisma.transactionNote.update({
      where: { id: noteId },
      data: { body: body.body.trim(), readByJson: [actor.userId] },
    });
    return NextResponse.json({ ok: true, note: updated });
  }

  // Mark as read — anyone in the account
  if (body.read) {
    const arr = Array.isArray(note.readByJson)
      ? (note.readByJson as string[])
      : [];
    if (!arr.includes(actor.userId)) {
      arr.push(actor.userId);
      await prisma.transactionNote.update({
        where: { id: noteId },
        data: { readByJson: arr },
      });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, noop: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; noteId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id, noteId } = await ctx.params;

  const note = await prisma.transactionNote.findUnique({
    where: { id: noteId },
    include: { transaction: { select: { accountId: true } } },
  });
  if (!note || note.transactionId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (note.transaction.accountId !== actor.accountId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Owner OR author can delete
  if (actor.role !== "owner" && note.authorUserId !== actor.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await prisma.transactionNote.delete({ where: { id: noteId } });
  return NextResponse.json({ ok: true });
}
