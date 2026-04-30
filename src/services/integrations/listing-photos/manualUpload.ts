/**
 * ManualUploadPhotoSource
 *
 * Concrete adapter — pulls photos from REOS's Document table where
 * category='property_photo' (manual upload through the UI).
 * Always configured; this is the universal fallback.
 */

import { prisma } from "@/lib/db";
import type { ListingPhoto, ListingPhotoSource } from "./types";

export const manualUploadPhotoSource: ListingPhotoSource = {
  id: "manual_upload",
  label: "Manual upload",
  async isConfigured() {
    return true;
  },
  async fetch({ transactionId }): Promise<ListingPhoto[]> {
    const docs = await prisma.document.findMany({
      where: {
        transactionId,
        category: "property_photo",
      },
      select: { id: true, fileName: true, mimeType: true, storageUrl: true },
      orderBy: { uploadedAt: "asc" },
    });
    return docs
      .filter((d) => d.storageUrl)
      .map((d) => ({
        url: d.storageUrl as string,
        source: "manual_upload" as const,
      }));
  },
};
