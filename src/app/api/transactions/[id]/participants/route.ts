/**
 * GET  /api/transactions/:id/participants  — list co-buyers/co-sellers/etc
 * POST /api/transactions/:id/participants  — add one
 *
 * Body for POST: { contactId?, fullName?, email?, phone?, role, notes? }
 * If contactId not provided, creates a new contact from fullName + email.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const VALID_ROLES = new Set([
  "co_buyer",
  "co_seller",
  "lender",
  "attorney",
  "inspector",
  "coordinator",
  "other",
]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const rows = await prisma.transactionParticipant.findMany({
    where: { transactionId: id },
    orderBy: { createdAt: "asc" },
    include: {
      contact: {
        select: {
          id: true,
          fullName: true,
          primaryEmail: true,
          primaryPhone: true,
        },
      },
    },
  });
  return NextResponse.json({
    items: rows.map((p) => ({
      id: p.id,
      role: p.role,
      notes: p.notes,
      createdAt: p.createdAt.toISOString(),
      contact: p.contact,
    })),
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    contactId?: string;
    fullName?: string;
    email?: string;
    phone?: string;
    role?: string;
    notes?: string;
  } | null;
  if (!body?.role || !VALID_ROLES.has(body.role)) {
    return NextResponse.json(
      { error: `role must be one of: ${[...VALID_ROLES].join(", ")}` },
      { status: 400 },
    );
  }

  let contactId = body.contactId;
  if (!contactId) {
    const name = body.fullName?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "contactId OR fullName required" },
        { status: 400 },
      );
    }
    const created = await prisma.contact.create({
      data: {
        accountId: txn.accountId,
        fullName: name.slice(0, 160),
        primaryEmail: body.email?.trim() || null,
        primaryPhone: body.phone?.trim() || null,
        sourceName: "transaction_participant",
      },
    });
    contactId = created.id;
  }

  try {
    const p = await prisma.transactionParticipant.create({
      data: {
        transactionId: id,
        contactId,
        role: body.role,
        notes: body.notes?.slice(0, 400) || null,
      },
      include: {
        contact: {
          select: {
            id: true,
            fullName: true,
            primaryEmail: true,
            primaryPhone: true,
          },
        },
      },
    });
    // Anti-overwrite guard — adding a party is a human edit
    await prisma.transaction
      .update({ where: { id }, data: { manuallyEditedAt: new Date() } })
      .catch(() => {});
    return NextResponse.json({ ok: true, participant: p });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json(
        { error: "that contact is already on this transaction with that role" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
