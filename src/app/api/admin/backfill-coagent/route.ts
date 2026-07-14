/**
 * POST /api/admin/backfill-coagent  (owner only)
 *
 * Back-fills the flat co-op-agent fields on EXISTING deals from the agent
 * participants already stored on each transaction — so the new "Other side &
 * title" block is populated immediately without waiting for a re-sync. The
 * co-op agent is the participant on the side OPPOSITE our representation; their
 * contact carries name/email/phone and the participant notes carry
 * "brokerage · Lic <n>". Enrich-only — never overwrites a value already set.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { ourSide } from "@/services/core/DealContactEnrichmentService";
import { rememberContact } from "@/services/core/KnownContactService";

export const runtime = "nodejs";

/** Parse "Keller Williams · Lic L-200" → { brokerage, license }. */
function parseAgentNotes(notes: string | null): { brokerage: string | null; license: string | null } {
  if (!notes) return { brokerage: null, license: null };
  const parts = notes.split("·").map((s) => s.trim());
  let brokerage: string | null = null;
  let license: string | null = null;
  for (const p of parts) {
    const lic = p.match(/^Lic\s+(.+)$/i);
    if (lic) license = lic[1]!.trim();
    else if (p) brokerage = p;
  }
  return { brokerage, license };
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { force?: boolean } | null;
  const force = body?.force ?? false;

  const deals = await prisma.transaction.findMany({
    where: { accountId: actor.accountId, isDemo: false },
    select: {
      id: true,
      side: true,
      transactionType: true,
      coAgentName: true,
      participants: {
        select: {
          role: true,
          notes: true,
          contact: { select: { fullName: true, primaryEmail: true, primaryPhone: true } },
        },
      },
    },
  });

  let updated = 0;
  const samples: string[] = [];
  for (const d of deals) {
    if (d.coAgentName && !force) continue;
    const side = ourSide(d);
    if (!side || side === "both") continue;
    const wantRoles =
      side === "buy" ? ["listing_agent", "co_listing_agent"] : ["buyers_agent", "co_buyers_agent"];
    const p = d.participants.find((x) => wantRoles.includes(x.role));
    if (!p?.contact?.fullName) continue;

    const { brokerage, license } = parseAgentNotes(p.notes);
    const data: Record<string, string> = {};
    const fill = (key: string, value: string | null | undefined, current: string | null) => {
      const v = value?.trim();
      if (v && (force || !current)) data[key] = v;
    };
    fill("coAgentName", p.contact.fullName, d.coAgentName);
    fill("coAgentBrokerage", brokerage, null);
    fill("coAgentPhone", p.contact.primaryPhone, null);
    fill("coAgentEmail", p.contact.primaryEmail, null);
    fill("coAgentLicense", license, null);
    if (Object.keys(data).length === 0) continue;

    await prisma.transaction.update({ where: { id: d.id }, data });
    updated++;
    if (samples.length < 8) samples.push(`${p.contact.fullName}${brokerage ? ` (${brokerage})` : ""}`);

    // Role-tag the co-op agent into the account contact directory so past
    // deals make REOS smarter (Vendors + recall on future deals).
    await rememberContact(prisma, actor.accountId, {
      name: p.contact.fullName,
      email: p.contact.primaryEmail,
      phone: p.contact.primaryPhone,
      role: side === "buy" ? "listing_agent" : "buyer_agent",
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, scanned: deals.length, updated, samples });
}
