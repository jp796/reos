/**
 * apifyZillowPhotoSource
 *
 * Listing-photo lookup via Apify's maintained Zillow scraper actor.
 * Reliable in production — Apify owns the bot-detection layer, so
 * we get clean JSON back instead of the 403s we hit when fetching
 * Zillow / Homes / Redfin directly from Cloud Run.
 *
 * Actor used: `maxcopell/zillow-search-scraper`. We call it via the
 * synchronous run-and-return-dataset endpoint so REOS gets the
 * result in a single HTTP round-trip rather than polling.
 *
 * Cost is ~$0.005 per address; the actor returns full listing data,
 * we just keep the first photo. Skipped silently when APIFY_API_TOKEN
 * isn't configured so the registry can fall through to other sources.
 */

import type { ListingPhoto, ListingPhotoSource } from "./types";
import { prisma } from "@/lib/db";

const APIFY_ACTOR_ID = "maxcopell~zillow-search-scraper";
const APIFY_BASE = "https://api.apify.com/v2";

// Sync runs cap at 300s on Apify's side. We give ourselves 25s — plenty
// for one address; if Apify is slow we fail fast and let the UI show a
// graceful empty-state instead of hanging the user's "Find photo" click.
const FETCH_TIMEOUT_MS = 25_000;

export const apifyZillowPhotoSource: ListingPhotoSource = {
  id: "public_scrape", // shares the registry slot with publicScrape; the route picks at runtime
  label: "Zillow via Apify",
  async isConfigured() {
    return !!process.env.APIFY_API_TOKEN;
  },
  async fetch({ transactionId }): Promise<ListingPhoto[]> {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) return [];

    const txn = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { propertyAddress: true, city: true, state: true },
    });
    const addressParts = [
      txn?.propertyAddress?.trim(),
      txn?.city?.trim(),
      txn?.state?.trim(),
    ].filter(Boolean) as string[];
    if (addressParts.length === 0) return [];
    const fullAddress = addressParts.join(", ");

    // Call the actor synchronously and have Apify hand us the dataset
    // items directly. Saves a polling loop and a follow-up GET.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let items: unknown[];
    try {
      const res = await fetch(
        `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctl.signal,
          body: JSON.stringify({
            // Actor's input schema — see https://apify.com/maxcopell/zillow-search-scraper
            // for the canonical reference. searchQueryState is what its
            // homepage form posts; the address string works as a simple
            // text query.
            search: fullAddress,
            maxItems: 1,
            extractionMethod: "PAGINATION_WITH_ZOOM_IN",
          }),
        },
      );
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.warn(
          `[apifyZillow] ${res.status} from Apify: ${errBody.slice(0, 200)}`,
        );
        return [];
      }
      items = (await res.json()) as unknown[];
    } catch (e) {
      console.warn("[apifyZillow] fetch failed:", e);
      return [];
    } finally {
      clearTimeout(timer);
    }

    if (!Array.isArray(items) || items.length === 0) return [];
    const first = items[0] as Record<string, unknown>;
    const photoUrl = pickPhotoUrl(first);
    if (!photoUrl) return [];

    return [
      {
        url: photoUrl,
        source: "public_scrape",
        caption: "Zillow",
      },
    ];
  },
};

/**
 * The actor returns different shapes depending on which Zillow page
 * yielded the match. Cover the common fields; null-safe so a schema
 * change doesn't crash the lookup.
 */
function pickPhotoUrl(item: Record<string, unknown>): string | null {
  // Direct field on listing-detail responses.
  if (typeof item.imgSrc === "string" && item.imgSrc.startsWith("http")) {
    return item.imgSrc;
  }
  if (typeof item.image === "string" && item.image.startsWith("http")) {
    return item.image;
  }
  // Photo gallery is sometimes an array of { url } or strings.
  const photos = item.photos as unknown;
  if (Array.isArray(photos) && photos.length > 0) {
    const first = photos[0];
    if (typeof first === "string" && first.startsWith("http")) return first;
    if (typeof first === "object" && first !== null) {
      const url = (first as Record<string, unknown>).url;
      if (typeof url === "string" && url.startsWith("http")) return url;
    }
  }
  // Some shapes nest under hdpData / listing media.
  const hdp = item.hdpData as Record<string, unknown> | undefined;
  if (hdp && typeof hdp === "object") {
    const homeInfo = hdp.homeInfo as Record<string, unknown> | undefined;
    if (homeInfo && typeof homeInfo.imgSrc === "string") {
      return homeInfo.imgSrc;
    }
  }
  return null;
}
