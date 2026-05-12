/**
 * Pluggable photo-source adapters.
 *
 * Each adapter knows how to fetch property photos for a given
 * transaction. The framework picks the active adapter from
 * Account.settingsJson.listingPhotoProvider; falls back to the
 * "manual_upload" adapter when no MLS integration is wired yet.
 *
 * Concrete today:
 *   - manual_upload   → photos uploaded via the transaction UI
 *
 * Stubs (fill in when we have buyers using each):
 *   - reso_web_api    → modern MLS standard (CRMLS, Bright, etc.)
 *   - rets            → legacy MLS standard, still common in WY/MO
 *   - cowork_browser  → Claude Cowork drives a browser, screenshots
 *                       the listing detail page (no-API fallback)
 *   - photographer_email → auto-detect Pixoreo / BoxBrownie / HDPhotoHub
 *                          gallery emails and ingest
 */

export type ListingPhotoProviderId =
  | "manual_upload"
  | "reso_web_api"
  | "rets"
  | "cowork_browser"
  | "photographer_email"
  | "public_scrape";

export interface ListingPhoto {
  /** Public URL or signed URL to display the photo. */
  url: string;
  /** Optional caption / order index. */
  caption?: string;
  width?: number;
  height?: number;
  /** Provenance (which adapter retrieved it). */
  source: ListingPhotoProviderId;
}

export interface ListingPhotoSource {
  readonly id: ListingPhotoProviderId;
  /** Human label shown in Settings. */
  readonly label: string;
  /** Whether this adapter has the credentials it needs. */
  isConfigured(accountId: string): Promise<boolean>;
  /** Fetch photos for one transaction. Empty array = nothing found. */
  fetch(args: {
    accountId: string;
    transactionId: string;
    /** Optional listing identifier — RESO uses ListingKey, RETS uses
     * MLS#, etc. */
    externalListingId?: string | null;
  }): Promise<ListingPhoto[]>;
}
