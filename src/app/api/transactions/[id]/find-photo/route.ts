/**
 * POST /api/transactions/:id/find-photo
 *
 * One-shot web lookup for the property's listing photo. Uses the
 * `public_scrape` adapter (Homes.com → Redfin) to find a primary
 * photo URL for the transaction's address.
 *
 * Returns { ok: true, photoUrl, source, caption } when found, or
 * { ok: false, reason } when nothing matched. Does NOT persist the
 * URL — the UI shows a preview and the user decides whether to
 * adopt it (which writes a Document via the existing upload path).
 *
 * Reasoning: scrape-based photo lookup is best-effort. Persisting
 * automatically risks ghost-attaching the wrong house. A confirm
 * step in the UI is cheap insurance.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import { publicScrapePhotoSource } from "@/services/integrations/listing-photos/publicScrape";
import { apifyZillowPhotoSource } from "@/services/integrations/listing-photos/apifyZillow";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, accountId: true, propertyAddress: true },
  });
  if (!txn) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  if (!txn.propertyAddress?.trim()) {
    return NextResponse.json(
      { ok: false, reason: "no_address" },
      { status: 400 },
    );
  }

  // Resolution order:
  //   1. Apify Zillow scraper — reliable, Apify handles the bot
  //      detection layer. Skipped when APIFY_API_TOKEN isn't set.
  //   2. publicScrape (Homes.com → Redfin) — free fallback. Currently
  //      403s from Cloud Run IPs but stays in place for dev /
  //      non-blocked environments.
  let photos = (await apifyZillowPhotoSource.isConfigured(actor.accountId))
    ? await apifyZillowPhotoSource.fetch({
        accountId: actor.accountId,
        transactionId: txn.id,
      })
    : [];
  if (photos.length === 0) {
    photos = await publicScrapePhotoSource.fetch({
      accountId: actor.accountId,
      transactionId: txn.id,
    });
  }

  if (photos.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: "not_found_on_public_sites",
      message:
        "No public listing photo found for this address. The property may not be listed publicly, or the sites blocked the lookup. Upload manually instead.",
    });
  }

  const [primary] = photos;
  return NextResponse.json({
    ok: true,
    photoUrl: primary.url,
    source: primary.source,
    caption: primary.caption ?? null,
  });
}
