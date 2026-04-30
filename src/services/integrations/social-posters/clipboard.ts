/**
 * Clipboard "poster" — the always-available default.
 *
 * Doesn't actually post anywhere. Returns posted=false with a note
 * so the UI knows to surface the copy buttons instead of a "Posted!"
 * confirmation. This is what we ship before a real poster is wired.
 */

import type {
  Platform,
  SocialPoster,
  SocialPostResult,
} from "./types";

const PLATFORMS: Platform[] = ["instagram", "facebook", "linkedin", "twitter"];

export const clipboardPoster: SocialPoster = {
  id: "clipboard",
  label: "Copy to clipboard (manual paste)",
  supports: PLATFORMS,
  async isConfigured() {
    return true;
  },
  async postBundle({ posts }): Promise<SocialPostResult[]> {
    return posts.map((p) => ({
      platform: p.platform,
      posted: false,
      error: "clipboard adapter — manual paste required",
    }));
  },
};
