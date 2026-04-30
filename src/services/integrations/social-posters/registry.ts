/**
 * Social-poster registry. Resolves the active poster from
 * `Account.settingsJson.socialPoster`. Falls back to "clipboard".
 */

import { prisma } from "@/lib/db";
import { clipboardPoster } from "./clipboard";
import {
  bufferPoster,
  directMetaPoster,
  directLinkedInPoster,
  coworkBrowserPoster,
} from "./stubs";
import type { SocialPoster, SocialPosterId } from "./types";

export const ALL_POSTERS: SocialPoster[] = [
  clipboardPoster,
  bufferPoster,
  directMetaPoster,
  directLinkedInPoster,
  coworkBrowserPoster,
];

const BY_ID: Record<SocialPosterId, SocialPoster> = {
  clipboard: clipboardPoster,
  buffer: bufferPoster,
  direct_meta: directMetaPoster,
  direct_linkedin: directLinkedInPoster,
  cowork_browser: coworkBrowserPoster,
};

export async function getActivePoster(
  accountId: string,
): Promise<SocialPoster> {
  const acct = await prisma.account.findUnique({
    where: { id: accountId },
    select: { settingsJson: true },
  });
  const settings = (acct?.settingsJson ?? {}) as Record<string, unknown>;
  const requested = settings.socialPoster as SocialPosterId | undefined;
  if (requested && BY_ID[requested]) {
    const adapter = BY_ID[requested];
    if (await adapter.isConfigured(accountId)) return adapter;
  }
  return clipboardPoster;
}
