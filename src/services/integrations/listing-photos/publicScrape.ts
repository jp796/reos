/**
 * publicScrapePhotoSource
 *
 * Best-effort multi-source listing-photo lookup. Given a property
 * address, tries each public listing site in order until one returns
 * a usable primary photo:
 *
 *   1. Homes.com — friendliest to scrape, OG:image on listing pages
 *   2. Redfin — second easiest, JSON-LD `image` on detail pages
 *   3. (Zillow needs Apify or BrightData — gated, deferred to v2)
 *
 * Strategy is simple and conservative: hit each site's public search
 * endpoint with the address, follow the first result link to the
 * detail page, parse the `og:image` (or JSON-LD) meta tag. No JS
 * rendering, no headless browser, no CAPTCHAs. When a site bot-blocks
 * us we just fall through to the next one.
 *
 * Why not full scrape: scraping these sites at scale is a TOS grey
 * area. This adapter is intended for *one-shot* per-transaction lookup
 * (a TC clicks "Find photo" once on their own listing), not bulk
 * crawling. We send a realistic User-Agent and don't retry aggressively.
 *
 * For production multi-tenant use the path forward is Apify's
 * maintained Zillow / Homes actors. Wire those in when the cost
 * tradeoff (~$0.005 per address) makes sense vs. a manual upload.
 */

import type { ListingPhoto, ListingPhotoSource } from "./types";
import { prisma } from "@/lib/db";

// Realistic browser UA — boring but minimizes the chance of getting
// the bot-detection treatment on first request.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const FETCH_TIMEOUT_MS = 8000;

/** Internal helper — fetch text with a timeout + realistic headers. */
async function fetchText(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the og:image content from an HTML body. */
function extractOgImage(html: string): string | null {
  // Look for both meta property="og:image" and name="og:image" variants.
  const m =
    html.match(
      /<meta\s+(?:property|name)\s*=\s*["']og:image["']\s+content\s*=\s*["']([^"']+)["']/i,
    ) ??
    html.match(
      /<meta\s+content\s*=\s*["']([^"']+)["']\s+(?:property|name)\s*=\s*["']og:image["']/i,
    );
  return m?.[1] ?? null;
}

/** Extract the first `image` URL from a JSON-LD script block. */
function extractJsonLdImage(html: string): string | null {
  // Greedy capture each <script type="application/ld+json"> block,
  // parse each, return the first JSON object that has an image field.
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      const img = pickJsonLdImage(json);
      if (img) return img;
    } catch {
      // ignore malformed blocks — Redfin sometimes inlines comments
    }
  }
  return null;
}

function pickJsonLdImage(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  if (typeof rec.image === "string") return rec.image;
  if (Array.isArray(rec.image) && typeof rec.image[0] === "string") {
    return rec.image[0];
  }
  // Sometimes nested under @graph.
  if (Array.isArray(rec["@graph"])) {
    for (const child of rec["@graph"]) {
      const found = pickJsonLdImage(child);
      if (found) return found;
    }
  }
  return null;
}

// =================================================================
// HOMES.COM
// =================================================================

async function homesDotComPhoto(address: string): Promise<string | null> {
  // Homes.com supports `/search?qry=<address>`. The first hit on the
  // results page is a detail-page link; we follow it and grab og:image.
  const searchUrl = `https://www.homes.com/search?qry=${encodeURIComponent(address)}`;
  const searchHtml = await fetchText(searchUrl);
  if (!searchHtml) return null;

  // First detail-page link looks like /property/<slug>/.
  const linkMatch = searchHtml.match(/href=["'](\/property\/[^"']+)["']/i);
  if (!linkMatch) return null;
  const detailUrl = `https://www.homes.com${linkMatch[1]}`;

  const detailHtml = await fetchText(detailUrl);
  if (!detailHtml) return null;

  return extractOgImage(detailHtml);
}

// =================================================================
// REDFIN
// =================================================================

async function redfinPhoto(address: string): Promise<string | null> {
  // Redfin's autocomplete API returns a stable URL fragment for the
  // address; following that gets us the detail page. Note: Redfin's
  // anti-bot is stricter than Homes — this often returns null. We
  // try anyway because when it works it's high quality.
  const search = await fetchText(
    `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(address)}&v=2`,
  );
  if (!search) return null;
  // Response is JSON-with-junk-prefix (Redfin quirk); strip the first
  // four chars before parsing.
  let parsed: unknown;
  try {
    parsed = JSON.parse(search.replace(/^{}&&/, ""));
  } catch {
    return null;
  }
  const payload = parsed as {
    payload?: { sections?: Array<{ rows?: Array<{ url?: string }> }> };
  };
  const firstUrl =
    payload.payload?.sections?.[0]?.rows?.[0]?.url ?? null;
  if (!firstUrl) return null;

  const detailHtml = await fetchText(`https://www.redfin.com${firstUrl}`);
  if (!detailHtml) return null;
  return extractJsonLdImage(detailHtml) ?? extractOgImage(detailHtml);
}

// =================================================================
// ADAPTER
// =================================================================

export const publicScrapePhotoSource: ListingPhotoSource = {
  id: "public_scrape",
  label: "Public listing sites (Homes.com / Redfin)",
  async isConfigured() {
    // No credentials needed — but require an account-level opt-in if
    // we ever want to gate it. For now it's always available.
    return true;
  },
  async fetch({ transactionId }): Promise<ListingPhoto[]> {
    const txn = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { propertyAddress: true },
    });
    if (!txn?.propertyAddress) return [];
    const address = txn.propertyAddress.trim();
    if (!address) return [];

    // Try each source. Stop at the first hit.
    const homes = await homesDotComPhoto(address);
    if (homes) {
      return [
        {
          url: homes,
          source: "public_scrape",
          caption: "Homes.com",
        },
      ];
    }

    const redfin = await redfinPhoto(address);
    if (redfin) {
      return [
        {
          url: redfin,
          source: "public_scrape",
          caption: "Redfin",
        },
      ];
    }

    // Nothing found — caller can fall back to manual upload UI.
    return [];
  },
};
