/**
 * Stub photo-source adapters.
 *
 * Each one is a placeholder so the framework + UI can light up
 * "Connect <source>" tiles right now. When you (or an end buyer)
 * provides the credentials and wants to wire it up, replace the
 * `fetch` body with the real call.
 */

import type { ListingPhotoSource } from "./types";

/* ============================================================
 * RESO Web API — modern MLS standard.
 * Most major MLSes expose a /Property + /Media endpoint over OAuth.
 *
 * To wire:
 *   1. Add account-level setting: { resoBaseUrl, resoToken }
 *   2. GET ${resoBaseUrl}/Property('${listingKey}')/Media
 *   3. Map MediaURL fields → ListingPhoto[]
 *
 * Example endpoint shape:
 *   https://api.bridgedataoutput.com/api/v2/test/listings/<key>/media
 *   Authorization: Bearer <token>
 * ============================================================ */
export const resoWebApiPhotoSource: ListingPhotoSource = {
  id: "reso_web_api",
  label: "MLS — RESO Web API",
  async isConfigured() {
    return false; // wire account.settingsJson.reso.{baseUrl,token}
  },
  async fetch() {
    throw new Error(
      "RESO Web API adapter not implemented yet. See src/services/integrations/listing-photos/stubs.ts.",
    );
  },
};

/* ============================================================
 * RETS — legacy MLS standard, still active in many regional MLSes.
 *
 * To wire:
 *   1. Use a RETS client lib (rets-client / rets.js)
 *   2. Login via account-stored URL + user/pass
 *   3. SearchPhotos(MLS#) → binary stream
 *   4. Push bytes into Document table OR sign a temporary URL
 * ============================================================ */
export const retsPhotoSource: ListingPhotoSource = {
  id: "rets",
  label: "MLS — RETS (legacy)",
  async isConfigured() {
    return false;
  },
  async fetch() {
    throw new Error(
      "RETS adapter not implemented yet. See src/services/integrations/listing-photos/stubs.ts.",
    );
  },
};

/* ============================================================
 * Cowork browser screenshot — works for any MLS with no API.
 *
 * To wire:
 *   1. Define a Cowork "task" that opens MLS, navigates to listing
 *      ID, screenshots the photo gallery
 *   2. Cowork returns image URLs; REOS stores them
 *
 * Pricing: ~$0.05-0.10 per task. Best as a one-off escape hatch.
 * ============================================================ */
export const coworkBrowserPhotoSource: ListingPhotoSource = {
  id: "cowork_browser",
  label: "Cowork browser screenshot",
  async isConfigured() {
    return false;
  },
  async fetch() {
    throw new Error(
      "Cowork browser adapter not implemented yet. See src/services/integrations/listing-photos/stubs.ts.",
    );
  },
};

/* ============================================================
 * Photographer email auto-attach.
 *
 * To wire:
 *   1. Allowlist photographer-platform sender domains:
 *      Pixoreo (@pixoreo.com), BoxBrownie (@boxbrownie.com),
 *      HD Photo Hub (@hdphotohub.com), Aryeo, etc.
 *   2. When morning-tick ingests their email, look for a gallery
 *      link, scrape thumbnails (with permission per ToS) or
 *      forward link to user with one-click "import"
 * ============================================================ */
export const photographerEmailPhotoSource: ListingPhotoSource = {
  id: "photographer_email",
  label: "Photographer email auto-attach",
  async isConfigured() {
    return false;
  },
  async fetch() {
    throw new Error(
      "Photographer email adapter not implemented yet. See src/services/integrations/listing-photos/stubs.ts.",
    );
  },
};
