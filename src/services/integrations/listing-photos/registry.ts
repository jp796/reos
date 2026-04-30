/**
 * Registry of photo-source adapters. Resolves the active provider
 * by reading `Account.settingsJson.listingPhotoProvider`. Falls
 * back to "manual_upload" when nothing is configured.
 */

import { prisma } from "@/lib/db";
import { manualUploadPhotoSource } from "./manualUpload";
import {
  resoWebApiPhotoSource,
  retsPhotoSource,
  coworkBrowserPhotoSource,
  photographerEmailPhotoSource,
} from "./stubs";
import type { ListingPhotoProviderId, ListingPhotoSource } from "./types";

export const ALL_PHOTO_SOURCES: ListingPhotoSource[] = [
  manualUploadPhotoSource,
  resoWebApiPhotoSource,
  retsPhotoSource,
  coworkBrowserPhotoSource,
  photographerEmailPhotoSource,
];

const BY_ID: Record<ListingPhotoProviderId, ListingPhotoSource> = {
  manual_upload: manualUploadPhotoSource,
  reso_web_api: resoWebApiPhotoSource,
  rets: retsPhotoSource,
  cowork_browser: coworkBrowserPhotoSource,
  photographer_email: photographerEmailPhotoSource,
};

export async function getActivePhotoSource(
  accountId: string,
): Promise<ListingPhotoSource> {
  const acct = await prisma.account.findUnique({
    where: { id: accountId },
    select: { settingsJson: true },
  });
  const settings = (acct?.settingsJson ?? {}) as Record<string, unknown>;
  const requested = settings.listingPhotoProvider as
    | ListingPhotoProviderId
    | undefined;
  if (requested && BY_ID[requested]) {
    const adapter = BY_ID[requested];
    if (await adapter.isConfigured(accountId)) return adapter;
  }
  return manualUploadPhotoSource;
}
