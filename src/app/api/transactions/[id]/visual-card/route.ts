/**
 * GET /api/transactions/:id/visual-card?event=new_listing
 *
 * Returns a 1200×1500 PNG visual card branded for the transaction's
 * account. Uses next/og to render the JSX template from
 * VisualCardService.
 *
 * Pulls listing photos via the same registry that powers Find photo
 * (Apify Zillow → public-scrape fallback). Brand kit + agent profile
 * cascade from BrokerageProfile + Account settings; falls back to
 * REAL_BROKER_DEFAULTS + JP_DEFAULTS while the Phase-1B settings
 * UIs aren't shipped yet.
 *
 * Returns the PNG directly (Content-Type: image/png), with a long
 * Cache-Control so subsequent loads are instant. Cache key = txn id
 * + event — re-render by appending a `cache-bust` query param.
 */

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertSameAccount } from "@/lib/require-session";
import {
  renderVisualCard,
  REAL_BROKER_DEFAULTS,
  JP_DEFAULTS,
  type BrandKit,
  type AgentProfile,
  type VisualCardEvent,
} from "@/services/ai/VisualCardService";
import { apifyZillowPhotoSource } from "@/services/integrations/listing-photos/apifyZillow";
import { publicScrapePhotoSource } from "@/services/integrations/listing-photos/publicScrape";
import type { ListingPhoto } from "@/services/integrations/listing-photos/types";

// Edge runtime is the canonical home for next/og — but our request
// owner-check + Prisma lookup needs Node. Next 15 supports next/og
// from nodejs runtime fine (slightly slower cold start but it works).
export const runtime = "nodejs";

const VALID_EVENTS = new Set<VisualCardEvent>([
  "new_listing",
  "under_contract",
  "sold",
]);

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const eventParam = req.nextUrl.searchParams.get("event") ?? "new_listing";
  if (!VALID_EVENTS.has(eventParam as VisualCardEvent)) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }
  const event = eventParam as VisualCardEvent;

  const txn = await prisma.transaction.findUnique({
    where: { id },
    include: {
      financials: true,
      account: {
        select: {
          id: true,
          businessName: true,
          settingsJson: true,
          brokerageProfile: { select: { configJson: true, name: true } },
        },
      },
    },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  // ── Brand kit cascade ─────────────────────────────────────────
  // brokerage profile > account override > system default.
  const profileBrand = readBrandKit(txn.account.brokerageProfile?.configJson);
  const accountBrand = readBrandKit(txn.account.settingsJson);
  const brand: BrandKit = {
    ...REAL_BROKER_DEFAULTS,
    ...profileBrand,
    ...accountBrand,
  };
  // If the brokerage profile has a name, prefer it over the constant.
  if (txn.account.brokerageProfile?.name) {
    brand.brokerageName = txn.account.brokerageProfile.name;
  }

  // ── Agent profile cascade ─────────────────────────────────────
  const accountAgent = readAgentProfile(txn.account.settingsJson);
  const agent: AgentProfile = { ...JP_DEFAULTS, ...accountAgent };

  // ── Listing photos ────────────────────────────────────────────
  // Apify first (multi-photo), publicScrape as the last-ditch.
  let photos: ListingPhoto[] = (await apifyZillowPhotoSource.isConfigured(actor.accountId))
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

  // ── Price logic mirrors SocialPostService.
  const price =
    event === "new_listing"
      ? (txn.listPrice ?? txn.financials?.salePrice ?? null)
      : (txn.financials?.salePrice ?? null);

  // ── Compute the absolute origin for image-src resolution.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (req.headers.get("origin") ||
      `${req.nextUrl.protocol}//${req.headers.get("host")}`);

  // ── Render the JSX → PNG.
  const response = renderVisualCard(
    {
      event,
      brand,
      agent,
      facts: {
        address: txn.propertyAddress ?? "",
        city: txn.city,
        state: txn.state,
        price: price ? Number(price) : null,
        beds: null,
        baths: null,
        sqft: null,
      },
      photos,
    },
    origin,
  );

  // Re-wrap to add a long-ish Cache-Control. ImageResponse already
  // returns the right Content-Type; we just inject the cache header.
  const headers = new Headers(response.headers);
  // Cache for an hour. Bust with ?cache-bust=<now> from the client
  // when the user wants a fresh render after editing brand or facts.
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

// =================================================================
// Helpers — pluck brand-kit and agent-profile sub-objects from the
// generic settingsJson / configJson bags. Type-safe and null-safe.
// =================================================================

function readBrandKit(json: unknown): Partial<BrandKit> {
  if (!json || typeof json !== "object") return {};
  const root = json as Record<string, unknown>;
  const kit = root.brandKit;
  if (!kit || typeof kit !== "object") return {};
  return kit as Partial<BrandKit>;
}

function readAgentProfile(json: unknown): Partial<AgentProfile> {
  if (!json || typeof json !== "object") return {};
  const root = json as Record<string, unknown>;
  const ap = root.agentProfile;
  if (!ap || typeof ap !== "object") return {};
  return ap as Partial<AgentProfile>;
}
