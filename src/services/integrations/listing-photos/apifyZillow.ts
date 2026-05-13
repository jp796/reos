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
  async isConfigured(_accountId: string) {
    void _accountId; // future: per-account Apify tokens; today it's account-wide
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
    // Collect up to 8 photos — caller decides how many to use.
    // Visual-card template wants 4 (hero + 3 thumbs); social post
    // attachments may want just 1.
    const photoUrls = pickAllPhotoUrls(first);
    if (photoUrls.length === 0) return [];

    return photoUrls.slice(0, 8).map((url, i) => ({
      url,
      source: "public_scrape" as const,
      caption: i === 0 ? "Zillow (primary)" : `Zillow (${i + 1})`,
    }));
  },
};

/**
 * Walk every photo-bearing field the actor returns and produce a
 * de-duplicated list of full-resolution URLs. Order: primary image
 * first, then the photo gallery in the order Zillow returned it.
 *
 * The shape varies by which Zillow surface the actor scraped — the
 * function is null-safe so a schema change doesn't crash the lookup.
 */
function pickAllPhotoUrls(item: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const add = (u: unknown) => {
    if (typeof u === "string" && u.startsWith("http") && !urls.includes(u)) {
      urls.push(u);
    }
  };
  // Top-level primary fields.
  add(item.imgSrc);
  add(item.image);
  // hdpData.homeInfo.imgSrc — listing-detail primary.
  const hdp = item.hdpData as Record<string, unknown> | undefined;
  if (hdp && typeof hdp === "object") {
    const homeInfo = hdp.homeInfo as Record<string, unknown> | undefined;
    if (homeInfo && typeof homeInfo === "object") add(homeInfo.imgSrc);
  }
  // photos[] — gallery of { url } or strings.
  const photos = item.photos as unknown;
  if (Array.isArray(photos)) {
    for (const p of photos) {
      if (typeof p === "string") add(p);
      else if (typeof p === "object" && p !== null) {
        const rec = p as Record<string, unknown>;
        add(rec.url);
        // Some shapes nest under `mixedSources.jpeg[].url`.
        const mixed = rec.mixedSources as Record<string, unknown> | undefined;
        const jpegs = mixed?.jpeg as unknown;
        if (Array.isArray(jpegs)) {
          for (const j of jpegs) {
            if (typeof j === "object" && j !== null) {
              add((j as Record<string, unknown>).url);
            }
          }
        }
      }
    }
  }
  return urls;
}
