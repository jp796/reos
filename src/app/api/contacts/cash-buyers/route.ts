/**
 * Cash-buyers segment (spec §7) — the saved disposition channel for
 * wholesale deals. Backed by Contact.rolesJson containing "cash_buyer".
 *
 * GET    — list the account's cash buyers (id, name, email, phone).
 * POST   — add a contact to the segment.   Body: { contactId }
 * DELETE — remove a contact.               ?contactId=...
 *
 * Tenancy: every contact is scoped to the caller's account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

const ROLE = "cash_buyer";

function rolesOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  // Postgres JSONB array containment — rolesJson @> ["cash_buyer"].
  const rows = await prisma.contact.findMany({
    where: {
      accountId: actor.accountId,
      rolesJson: { array_contains: [ROLE] },
    },
    select: { id: true, fullName: true, primaryEmail: true, primaryPhone: true },
    orderBy: { fullName: "asc" },
  });
  return NextResponse.json({ contacts: rows, count: rows.length });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const body = (await req.json().catch(() => null)) as { contactId?: string } | null;
  if (!body?.contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }
  const contact = await prisma.contact.findFirst({
    where: { id: body.contactId, accountId: actor.accountId },
    select: { id: true, rolesJson: true },
  });
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const roles = new Set(rolesOf(contact.rolesJson));
  roles.add(ROLE);
  await prisma.contact.update({
    where: { id: contact.id },
    data: { rolesJson: Array.from(roles) },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const contactId = new URL(req.url).searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, accountId: actor.accountId },
    select: { id: true, rolesJson: true },
  });
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const roles = rolesOf(contact.rolesJson).filter((r) => r !== ROLE);
  await prisma.contact.update({
    where: { id: contact.id },
    data: { rolesJson: roles },
  });
  return NextResponse.json({ ok: true });
}
