/**
 * POST /api/admin/backfill-sellers-from-ghl
 *
 * Pull motivated-seller intel from GHL onto EVERY investment deal in the
 * account (investor / wholesale / principal-represented) that doesn't already
 * have it. Owner-only, tenant-scoped, idempotent. Uses the account's stored
 * GHL key. Body: { force?: boolean } to re-pull deals that already have intel.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";
import { GhlService } from "@/services/integrations/GhlService";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { ghlApiKeyEncrypted: true, ghlLocationId: true },
  });
  if (!GhlService.isConfigured(account?.ghlApiKeyEncrypted, account?.ghlLocationId)) {
    return NextResponse.json(
      { error: "GHL not connected — connect it in Settings → Integrations first." },
      { status: 412 },
    );
  }
  let token: string;
  try {
    token = getEncryptionService().decrypt(account!.ghlApiKeyEncrypted!);
  } catch {
    return NextResponse.json({ error: "Stored GHL key could not be read." }, { status: 500 });
  }
  const svc = new GhlService(token, account!.ghlLocationId!);

  // Investment deals: investor/wholesale type, or principal representation.
  const deals = await prisma.transaction.findMany({
    where: {
      accountId: actor.accountId,
      OR: [
        { transactionType: { in: ["investor", "wholesale"] } },
        { asset: { representation: "principal" } },
      ],
    },
    select: {
      id: true,
      propertyAddress: true,
      side: true,
      sellerIntelJson: true,
      contact: { select: { id: true, fullName: true } },
      participants: {
        where: { role: { in: ["co_seller", "seller"] } },
        select: { contact: { select: { id: true, fullName: true } } },
      },
    },
  });

  let pulled = 0;
  let noMatch = 0;
  let skipped = 0;
  let failed = 0;
  const pulledDeals: string[] = [];

  for (const d of deals) {
    if (d.sellerIntelJson && !force) {
      skipped++;
      continue;
    }
    const sellerContacts = [
      ...(d.side === "sell" && d.contact ? [d.contact] : []),
      ...d.participants.map((p) => p.contact),
    ];
    const sellerName = sellerContacts[0]?.fullName ?? d.contact?.fullName ?? null;

    try {
      const intel = await svc.pullSeller({ sellerName, propertyAddress: d.propertyAddress });
      if (!intel) {
        noMatch++;
        continue;
      }
      intel.pulledAt = new Date().toISOString();
      await prisma.transaction.update({
        where: { id: d.id },
        data: { sellerIntelJson: intel as unknown as Prisma.InputJsonValue },
      });
      const cid = sellerContacts[0]?.id;
      if (cid) {
        const c = await prisma.contact.findUnique({
          where: { id: cid },
          select: { primaryEmail: true, primaryPhone: true },
        });
        const upd: Record<string, string> = {};
        if (intel.emails[0] && !c?.primaryEmail) upd.primaryEmail = intel.emails[0];
        if (intel.phones[0] && !c?.primaryPhone) upd.primaryPhone = intel.phones[0];
        if (Object.keys(upd).length > 0) await prisma.contact.update({ where: { id: cid }, data: upd });
      }
      pulled++;
      if (d.propertyAddress) pulledDeals.push(d.propertyAddress);
    } catch {
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    investmentDeals: deals.length,
    pulled,
    noMatch,
    skipped,
    failed,
    pulledDeals: pulledDeals.slice(0, 50),
    summary: `Pulled sellers onto ${pulled} of ${deals.length} investment deals (${noMatch} no GHL match, ${skipped} already had intel, ${failed} errored).`,
  });
}
