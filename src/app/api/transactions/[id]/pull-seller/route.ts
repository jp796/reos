/**
 * POST /api/transactions/:id/pull-seller
 *
 * Pull the motivated-seller's contact info + intel from GoHighLevel onto an
 * investment deal: matches the GHL seller lead by name/property, then persists
 * all phones/emails + motivation / condition / timeline / lead tier as the
 * deal's Seller Intel, and enriches the seller contact. Tenant-scoped.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";
import { GhlService, type SellerIntel } from "@/services/integrations/GhlService";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: {
      id: true,
      accountId: true,
      side: true,
      propertyAddress: true,
      contact: { select: { id: true, fullName: true } },
      participants: {
        where: { role: { in: ["co_seller", "seller"] } },
        select: { contact: { select: { id: true, fullName: true } } },
      },
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const guard = assertSameAccount(actor, txn.accountId);
  if (guard) return guard;

  const account = await prisma.account.findUnique({
    where: { id: txn.accountId },
    select: { ghlApiKeyEncrypted: true, ghlLocationId: true },
  });
  if (!GhlService.isConfigured(account?.ghlApiKeyEncrypted, account?.ghlLocationId)) {
    return NextResponse.json(
      { error: "GHL not connected — add your GHL Private Integration token in Settings → Integrations." },
      { status: 412 },
    );
  }

  let token: string;
  try {
    token = getEncryptionService().decrypt(account!.ghlApiKeyEncrypted!);
  } catch {
    return NextResponse.json({ error: "Stored GHL key could not be read." }, { status: 500 });
  }

  // Candidate seller names: the seller side of the deal.
  const sellerContacts = [
    ...(txn.side === "sell" && txn.contact ? [txn.contact] : []),
    ...txn.participants.map((p) => p.contact),
  ];
  const sellerName = sellerContacts[0]?.fullName ?? txn.contact?.fullName ?? null;

  const svc = new GhlService(token, account!.ghlLocationId!);
  let intel: SellerIntel | null;
  try {
    intel = await svc.pullSeller({ sellerName, propertyAddress: txn.propertyAddress });
  } catch (e) {
    return NextResponse.json(
      { error: `GHL lookup failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}` },
      { status: 502 },
    );
  }
  if (!intel) {
    return NextResponse.json(
      { ok: false, found: false, error: "No matching seller lead found in GHL for this deal." },
      { status: 404 },
    );
  }

  intel.pulledAt = new Date().toISOString();

  // Persist: the full intel on the deal + enrich the seller contact (fill
  // empty email/phone only — never overwrite a human value).
  await prisma.transaction.update({
    where: { id: txn.id },
    data: { sellerIntelJson: intel as unknown as Prisma.InputJsonValue },
  });

  const sellerContactId = sellerContacts[0]?.id;
  if (sellerContactId) {
    const c = await prisma.contact.findUnique({
      where: { id: sellerContactId },
      select: { primaryEmail: true, primaryPhone: true },
    });
    const data: Record<string, string> = {};
    if (intel.emails[0] && !c?.primaryEmail) data.primaryEmail = intel.emails[0];
    if (intel.phones[0] && !c?.primaryPhone) data.primaryPhone = intel.phones[0];
    if (Object.keys(data).length > 0) {
      await prisma.contact.update({ where: { id: sellerContactId }, data });
    }
  }

  return NextResponse.json({
    ok: true,
    found: true,
    intel,
    summary: `Pulled ${intel.name ?? "seller"}: ${intel.phones.length} phone(s), ${intel.emails.length} email(s)${intel.motivationSignal ? ` · ${intel.motivationSignal}` : ""}.`,
  });
}
