/**
 * SocialTemplateRenderer
 *
 * Variable substitution for SocialPostTemplate.body. When a user has
 * stored a custom template for (event × platform), SocialPostService
 * runs it through this renderer instead of calling OpenAI for that
 * slot. Empty / missing variables degrade gracefully (replaced with
 * a placeholder rather than throwing).
 *
 * Supported variables (case-sensitive, double-braces):
 *
 *   {{address}}          — full property address
 *   {{city}} / {{state}} — city + state separately
 *   {{price}}            — list price for new_listing, sale price
 *                          for under_contract / sold; pre-formatted
 *                          with $ + thousands separators
 *   {{beds}} / {{baths}} / {{sqft}}  — from transaction.financials
 *                                       when populated
 *   {{agent_name}}       — broker.agentName ?? account.businessName
 *   {{brokerage_name}}   — broker.brokerageName ?? account.businessName
 *   {{event_label}}      — "Just Listed" / "Under Contract" / "Just Sold"
 *   {{side_verb}}        — "listing" / "helping a buyer secure"
 *                          / "representing both sides on"
 *   {{hashtags}}         — auto-generated hashtag block (8-12 tags
 *                          mixing city, brand, event, generic)
 */

import type { SocialEvent } from "./SocialPostService";

export interface TemplateContext {
  event: SocialEvent;
  address: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  agentName: string;
  brokerageName: string;
  side: string | null;
}

const EVENT_LABELS: Record<SocialEvent, string> = {
  new_listing: "Just Listed",
  under_contract: "Under Contract",
  sold: "Just Sold",
};

const EVENT_HASHTAGS: Record<SocialEvent, string[]> = {
  new_listing: ["#JustListed", "#NewListing", "#ForSale"],
  under_contract: ["#UnderContract", "#PendingSale"],
  sold: ["#JustSold", "#Sold", "#HappyClients"],
};

function sideVerb(side: string | null, event: SocialEvent): string {
  if (event === "sold") {
    if (side === "sell") return "representing the seller on";
    if (side === "buy") return "helping a buyer secure";
    if (side === "both") return "representing both sides on";
  }
  if (event === "new_listing") return "listing";
  if (event === "under_contract") {
    if (side === "sell") return "going pending on";
    if (side === "buy") return "going pending with our buyer on";
    return "going pending on";
  }
  return "working";
}

function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "[price]";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function slugifyCity(city: string | null): string {
  if (!city) return "";
  return city.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function buildHashtags(ctx: TemplateContext): string {
  const tags: string[] = [...EVENT_HASHTAGS[ctx.event]];
  const cityTag = slugifyCity(ctx.city);
  if (cityTag) tags.push(`#${cityTag}RealEstate`, `#${cityTag}Homes`);
  if (ctx.state) tags.push(`#${ctx.state.toUpperCase()}RealEstate`);
  // Brand tag from brokerage — strip spaces, simple casing.
  const brandTag = ctx.brokerageName.replace(/[^A-Za-z0-9]/g, "");
  if (brandTag) tags.push(`#${brandTag}`);
  // Always-on generic anchors.
  tags.push("#Realtor", "#RealEstate", "#HomeBuying", "#HomeSelling");
  // Dedup + cap at 12.
  return Array.from(new Set(tags)).slice(0, 12).join(" ");
}

export function buildVariables(ctx: TemplateContext): Record<string, string> {
  return {
    address: ctx.address ?? "[address]",
    city: ctx.city ?? "[city]",
    state: ctx.state ?? "[state]",
    price: formatPrice(ctx.price),
    beds: ctx.beds != null ? String(ctx.beds) : "[beds]",
    baths: ctx.baths != null ? String(ctx.baths) : "[baths]",
    sqft: ctx.sqft != null ? `${ctx.sqft.toLocaleString("en-US")} sqft` : "[sqft]",
    agent_name: ctx.agentName,
    brokerage_name: ctx.brokerageName,
    event_label: EVENT_LABELS[ctx.event],
    side_verb: sideVerb(ctx.side, ctx.event),
    hashtags: buildHashtags(ctx),
  };
}

/**
 * Render a template body with {{double-brace}} variable substitution.
 * Unknown keys are left in place (visible) so the user spots typos
 * in their template instead of getting a silently-broken post.
 */
export function renderTemplate(
  body: string,
  ctx: TemplateContext,
): string {
  const vars = buildVariables(ctx);
  return body.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (full, key: string) => {
    const v = vars[key];
    return v === undefined ? full : v;
  });
}

/** Canonical list of template variables, for the settings UI legend. */
export const TEMPLATE_VARIABLE_REFERENCE: Array<{
  key: string;
  description: string;
  example: string;
}> = [
  { key: "address", description: "Full property address", example: "123 Elm St" },
  { key: "city", description: "City", example: "Springfield" },
  { key: "state", description: "State (2-letter)", example: "MO" },
  { key: "price", description: "Formatted price", example: "$340,000" },
  { key: "beds", description: "Bedrooms", example: "3" },
  { key: "baths", description: "Bathrooms", example: "2" },
  { key: "sqft", description: "Square footage", example: "1,850 sqft" },
  { key: "agent_name", description: "Your name", example: "JP Fluellen" },
  { key: "brokerage_name", description: "Your brokerage", example: "Real Broker LLC" },
  { key: "event_label", description: "Event label", example: "Just Listed" },
  { key: "side_verb", description: "Side-aware verb phrase", example: "representing the seller on" },
  { key: "hashtags", description: "Auto-built hashtag block", example: "#JustListed #SpringfieldRealEstate …" },
];
