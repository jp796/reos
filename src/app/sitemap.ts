/**
 * Dynamic sitemap at /sitemap.xml — Next.js auto-generates the XML
 * from the array returned here. Listed in /public/robots.txt as the
 * canonical sitemap location.
 *
 * Only includes public, crawlable URLs. Authenticated routes are
 * explicitly Disallow-ed in robots.txt; no point listing them here.
 *
 * Priority + changeFrequency are advisory only — modern Google
 * ignores them but other crawlers still respect the hints.
 */

import type { MetadataRoute } from "next";
import { allCompetitors } from "./vs/competitors";

export const dynamic = "force-static";
export const revalidate = 86400; // refresh once a day

const BASE = "https://myrealestateos.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const competitorEntries: MetadataRoute.Sitemap = allCompetitors().map(
    (c) => ({
      url: `${BASE}/vs/${c.slug}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    }),
  );
  return [
    {
      url: `${BASE}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE}/demo`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${BASE}/signup`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${BASE}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/data-deletion`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    ...competitorEntries,
  ];
}
