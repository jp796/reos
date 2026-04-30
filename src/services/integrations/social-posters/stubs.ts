/**
 * Stub poster adapters. Each one is the wireup skeleton; replace
 * the postBundle body with the real call when we have credentials.
 */

import type { SocialPoster } from "./types";

/* ============================================================
 * Buffer — single OAuth, posts to all major platforms.
 *
 * To wire:
 *   1. account.settingsJson.buffer.{accessToken, profileIds}
 *   2. POST https://api.bufferapp.com/1/updates/create.json
 *      body: text=<caption>&profile_ids[]=<profileId>&media[photo]=<url>
 *   3. Map results to SocialPostResult[]
 *
 * Buffer Docs: https://buffer.com/developers/api/updates#updatescreate
 * ============================================================ */
export const bufferPoster: SocialPoster = {
  id: "buffer",
  label: "Buffer (recommended)",
  supports: ["instagram", "facebook", "linkedin", "twitter"],
  async isConfigured() {
    return false; // wire account.settingsJson.buffer.accessToken
  },
  async postBundle() {
    throw new Error(
      "Buffer adapter not implemented yet. See src/services/integrations/social-posters/stubs.ts.",
    );
  },
};

/* ============================================================
 * Direct Meta (Facebook Pages + Instagram Graph).
 * Requires: Meta Business app review, page admin access tokens,
 * IG Business/Creator account linked to the FB Page.
 * ============================================================ */
export const directMetaPoster: SocialPoster = {
  id: "direct_meta",
  label: "Direct — Meta (FB + IG)",
  supports: ["facebook", "instagram"],
  async isConfigured() {
    return false;
  },
  async postBundle() {
    throw new Error(
      "Direct Meta adapter not implemented yet. See src/services/integrations/social-posters/stubs.ts.",
    );
  },
};

/* ============================================================
 * Direct LinkedIn (Marketing API).
 * Requires: page admin permission, app approval for w_organization_social.
 * ============================================================ */
export const directLinkedInPoster: SocialPoster = {
  id: "direct_linkedin",
  label: "Direct — LinkedIn",
  supports: ["linkedin"],
  async isConfigured() {
    return false;
  },
  async postBundle() {
    throw new Error(
      "Direct LinkedIn adapter not implemented yet. See src/services/integrations/social-posters/stubs.ts.",
    );
  },
};

/* ============================================================
 * Cowork browser — Cowork drives the native UI of each platform.
 * Pricing: ~$0.05-0.10 per post. Slow but no API setup.
 * ============================================================ */
export const coworkBrowserPoster: SocialPoster = {
  id: "cowork_browser",
  label: "Cowork browser (no API)",
  supports: ["instagram", "facebook", "linkedin", "twitter"],
  async isConfigured() {
    return false;
  },
  async postBundle() {
    throw new Error(
      "Cowork browser poster not implemented yet. See src/services/integrations/social-posters/stubs.ts.",
    );
  },
};
