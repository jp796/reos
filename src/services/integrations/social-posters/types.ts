/**
 * Pluggable social-post poster adapters.
 *
 * Each adapter knows how to publish a social post (caption + image)
 * to one or more platforms. The framework picks the active adapter
 * from Account.settingsJson.socialPoster; falls back to the
 * "clipboard" adapter when nothing is wired (the user copy-pastes
 * the caption manually — what ships today).
 *
 * Concrete:
 *   - clipboard      → no posting; UI returns the caption for copy
 *
 * Stubs (fill in when you have buyers using each):
 *   - buffer         → Buffer's REST API (single OAuth, all platforms,
 *                      ~$15/mo). Recommended default.
 *   - direct_meta    → FB Pages Graph + IG Graph, requires app review
 *   - direct_linkedin → LinkedIn Marketing API
 *   - cowork_browser → Cowork drives the platform's web UI
 */

export type SocialPosterId =
  | "clipboard"
  | "buffer"
  | "direct_meta"
  | "direct_linkedin"
  | "cowork_browser";

export type Platform = "instagram" | "facebook" | "linkedin" | "twitter";

export interface SocialPostPayload {
  caption: string;
  hashtags?: string[];
  /** Public URL or signed URL for the image to attach. */
  imageUrl?: string;
  /** Platform this caption was tuned for. */
  platform: Platform;
}

export interface SocialPostResult {
  platform: Platform;
  posted: boolean;
  externalId?: string;
  error?: string;
}

export interface SocialPoster {
  readonly id: SocialPosterId;
  readonly label: string;
  /** Platforms this adapter can post to. */
  supports: Platform[];
  isConfigured(accountId: string): Promise<boolean>;
  /** Publishes one post per platform supplied. */
  postBundle(args: {
    accountId: string;
    posts: SocialPostPayload[];
  }): Promise<SocialPostResult[]>;
}
