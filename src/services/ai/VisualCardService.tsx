/**
 * VisualCardService
 *
 * Renders a branded social-post visual (PNG) for a transaction event
 * using next/og's ImageResponse. Output is 1200×1500 (portrait) tuned
 * for Instagram + Facebook feed.
 *
 * SaaS architecture — multi-tenant by design:
 *
 *   Brand kit cascade:
 *     BrokerageProfile.configJson.brandKit   (highest priority)
 *     → Account.settingsJson.brandKit         (agent-level override)
 *     → REAL_BROKER_DEFAULTS                  (system fallback)
 *
 *   Agent profile cascade:
 *     Account.settingsJson.agentProfile
 *     → JP_DEFAULTS                            (system fallback)
 *
 *   Photos:
 *     ListingPhoto[] from any registry adapter (Apify, manualUpload, …).
 *     Template uses first 4 — hero + 3 thumbs. Gracefully handles 1-4+.
 *
 * Phase 1B (later) adds /settings/brand and /settings/profile UIs that
 * populate the cascade — the renderer is already reading from the
 * right fields, just falling back to constants until they're filled.
 */
/* eslint-disable @next/next/no-img-element */

import { ImageResponse } from "next/og";
import type { ListingPhoto } from "@/services/integrations/listing-photos/types";

// =================================================================
// TYPES
// =================================================================

export type VisualCardEvent = "new_listing" | "under_contract" | "sold";

export interface BrandKit {
  /** Background color — usually the brokerage's primary dark tone. */
  cobalt: string;
  /** Light tone for cards / text on dark. */
  chalk: string;
  /** Bright accent for prices + stats. */
  aqua: string;
  /** Hot accent for event-badge script lettering. */
  coral: string;
  /** Subtle accent for borders + dividers. */
  seaglass: string;
  /** Display name shown in the bottom-right brand stripe. */
  brokerageName: string;
  /** Public URL of the brokerage logo image (absolute or absolute-path). */
  brokerageLogoUrl?: string;
  /** Display name of the title-company badge (bottom-left). Optional. */
  titleCompanyName?: string | null;
}

export interface AgentProfile {
  displayName: string;
  title: string;
  cellPhone?: string;
  officePhone?: string;
  /** Public URL of the agent's headshot. Absolute or absolute-path. */
  headshotUrl?: string;
}

export interface ListingFacts {
  address: string;
  city?: string | null;
  state?: string | null;
  price?: number | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  /** Free-form descriptor row beneath the facts ("3 Car Garage · Owner/Agent"). */
  features?: string[];
}

export interface VisualCardInput {
  event: VisualCardEvent;
  brand: BrandKit;
  agent: AgentProfile;
  facts: ListingFacts;
  photos: ListingPhoto[];
}

// =================================================================
// DEFAULTS — Real Broker palette + JP's agent block
//   These are the system fallbacks. Once Phase 1B settings ship,
//   Brokerage admins fill in the brand kit, agents fill the profile,
//   and the cascade above pulls from those rows instead of these
//   constants. Hard-coding here means JP gets working cards today.
// =================================================================

export const REAL_BROKER_DEFAULTS: BrandKit = {
  cobalt: "#050E3D",
  chalk: "#FFFFFF",
  aqua: "#00FBF0",
  coral: "#FF557E",
  seaglass: "#BFDDDB",
  brokerageName: "Real Broker LLC",
  brokerageLogoUrl: "/brand/real-broker-logo.jpg",
  titleCompanyName: "Clear2Close",
};

export const JP_DEFAULTS: AgentProfile = {
  displayName: "JP Fluellen",
  title: "Investor-Agent · Real Broker LLC",
  cellPhone: "417-340-1927",
  officePhone: "307-772-1184",
  headshotUrl: "/brand/jp-headshot.jpg",
};

const EVENT_LABEL: Record<VisualCardEvent, string> = {
  new_listing: "New Listing",
  under_contract: "Pending!",
  sold: "Just Sold",
};

// =================================================================
// RENDERER
// =================================================================

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Price upon request";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function factsLine(f: ListingFacts): string {
  const parts: string[] = [];
  if (f.beds != null) parts.push(`${f.beds} Bed${f.beds === 1 ? "" : "s"}`);
  if (f.baths != null) parts.push(`${f.baths} Bath${f.baths === 1 ? "" : "s"}`);
  if (f.sqft != null) parts.push(`${f.sqft.toLocaleString("en-US")} SqFt`);
  return parts.join("  ·  ");
}

/**
 * Resolve a possibly-relative URL against the absolute origin so
 * next/og's image fetcher can load it. The renderer runs server-side
 * but the URL fetch is from a sandbox — relative paths don't resolve.
 */
function abs(url: string | undefined, origin: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${origin}${url}`;
  return `${origin}/${url}`;
}

/**
 * Render a visual card to PNG via ImageResponse.
 *
 * `origin` is the absolute base URL (e.g. https://myrealestateos.com)
 * — passed in by the caller because the request context owns it.
 */
export function renderVisualCard(
  input: VisualCardInput,
  origin: string,
): ImageResponse {
  const { brand, agent, facts, photos, event } = input;
  const hero = photos[0]?.url;
  const thumbs = photos.slice(1, 4).map((p) => p.url);
  const eventLabel = EVENT_LABEL[event];
  const headshotUrl = abs(agent.headshotUrl, origin);
  const logoUrl = abs(brand.brokerageLogoUrl, origin);
  const addressLine = [facts.address, facts.city, facts.state]
    .filter(Boolean)
    .join(", ");

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 1500,
          display: "flex",
          flexDirection: "column",
          background: brand.cobalt,
          fontFamily: "Inter, Arial, sans-serif",
          color: brand.chalk,
        }}
      >
        {/* ── Hero photo + price + event badge ────────────────────── */}
        <div
          style={{
            position: "relative",
            width: 1200,
            height: 800,
            display: "flex",
            background: "#000",
          }}
        >
          {hero ? (
            <img
              src={hero}
              alt="Listing"
              width={1200}
              height={800}
              style={{ width: 1200, height: 800, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 1200,
                height: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: brand.seaglass,
              }}
            >
              No listing photo found
            </div>
          )}

          {/* Price strip — Aqua bar bottom-left */}
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: 60,
              padding: "20px 40px",
              background: brand.aqua,
              color: brand.cobalt,
              fontSize: 76,
              fontWeight: 800,
              display: "flex",
              letterSpacing: -1,
            }}
          >
            {formatPrice(facts.price)}
          </div>

          {/* Event script — Coral, bottom-right, large */}
          <div
            style={{
              position: "absolute",
              right: 40,
              bottom: 40,
              padding: "8px 24px",
              fontSize: 96,
              fontStyle: "italic",
              fontWeight: 700,
              color: brand.coral,
              textShadow: "0 4px 12px rgba(0,0,0,0.6)",
              display: "flex",
              transform: "rotate(-4deg)",
            }}
          >
            {eventLabel}
          </div>
        </div>

        {/* ── Three thumb photos ──────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            width: 1200,
            height: 280,
            background: brand.cobalt,
            padding: "16px 16px 0 16px",
            gap: 12,
          }}
        >
          {[0, 1, 2].map((i) => {
            const url = thumbs[i];
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  display: "flex",
                  height: 264,
                  background: "#0c1a4a",
                  border: `2px solid ${brand.seaglass}`,
                  overflow: "hidden",
                }}
              >
                {url ? (
                  <img
                    src={url}
                    alt={`Thumb ${i + 1}`}
                    width={388}
                    height={264}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      color: brand.seaglass,
                    }}
                  >
                    —
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Facts row ──────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "24px 40px 0 40px",
            color: brand.chalk,
          }}
        >
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -0.5, display: "flex" }}>
            {addressLine || facts.address}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 26,
              color: brand.seaglass,
              display: "flex",
            }}
          >
            {factsLine(facts)}
          </div>
          {facts.features && facts.features.length > 0 && (
            <div
              style={{
                marginTop: 4,
                fontSize: 22,
                color: brand.seaglass,
                display: "flex",
              }}
            >
              {facts.features.join(" · ")}
            </div>
          )}
        </div>

        {/* ── Agent + brand stripe ───────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "24px 40px 32px 40px",
            marginTop: "auto",
          }}
        >
          {/* Headshot + name + contact */}
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {headshotUrl ? (
              <img
                src={headshotUrl}
                alt={agent.displayName}
                width={130}
                height={130}
                style={{
                  width: 130,
                  height: 130,
                  borderRadius: 65,
                  border: `4px solid ${brand.aqua}`,
                  objectFit: "cover",
                }}
              />
            ) : (
              <div
                style={{
                  width: 130,
                  height: 130,
                  borderRadius: 65,
                  background: brand.aqua,
                  color: brand.cobalt,
                  fontSize: 56,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {agent.displayName
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 28, fontWeight: 700, display: "flex" }}>
                {agent.displayName}
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: brand.seaglass,
                  marginTop: 2,
                  display: "flex",
                }}
              >
                {agent.title}
              </div>
              {agent.cellPhone && (
                <div style={{ fontSize: 18, marginTop: 6, display: "flex" }}>
                  Cell: {agent.cellPhone}
                </div>
              )}
              {agent.officePhone && (
                <div style={{ fontSize: 18, display: "flex" }}>
                  Office: {agent.officePhone}
                </div>
              )}
            </div>
          </div>

          {/* Brand block (logo + reaL fallback) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 6,
            }}
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={brand.brokerageName}
                height={70}
                style={{
                  height: 70,
                  background: brand.chalk,
                  padding: "8px 16px",
                  border: `2px solid ${brand.chalk}`,
                }}
              />
            ) : (
              <div
                style={{
                  padding: "8px 16px",
                  background: brand.chalk,
                  color: brand.cobalt,
                  fontSize: 36,
                  fontWeight: 800,
                  letterSpacing: 2,
                  display: "flex",
                  border: `4px solid ${brand.chalk}`,
                }}
              >
                reaL
              </div>
            )}
            {brand.titleCompanyName && (
              <div
                style={{
                  fontSize: 14,
                  color: brand.seaglass,
                  display: "flex",
                }}
              >
                Powered by {brand.titleCompanyName}
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 1500,
    },
  );
}
