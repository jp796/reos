/**
 * GET  /api/settings/integrations  — current selection + adapter list
 * POST /api/settings/integrations  — owner-only; pick the active
 *                                    photo source / poster.
 *
 * Stored in Account.settingsJson.{listingPhotoProvider,socialPoster}.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireOwner } from "@/lib/require-session";
import { ALL_PHOTO_SOURCES } from "@/services/integrations/listing-photos/registry";
import type { ListingPhotoProviderId } from "@/services/integrations/listing-photos/types";
import { ALL_POSTERS } from "@/services/integrations/social-posters/registry";
import type { SocialPosterId } from "@/services/integrations/social-posters/types";

export async function GET() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;

  const photoSourcesWithStatus = await Promise.all(
    ALL_PHOTO_SOURCES.map(async (a) => ({
      id: a.id,
      label: a.label,
      configured: await a.isConfigured(actor.accountId),
    })),
  );
  const postersWithStatus = await Promise.all(
    ALL_POSTERS.map(async (a) => ({
      id: a.id,
      label: a.label,
      supports: a.supports,
      configured: await a.isConfigured(actor.accountId),
    })),
  );

  return NextResponse.json({
    listingPhotoProvider:
      (settings.listingPhotoProvider as ListingPhotoProviderId) ??
      "manual_upload",
    socialPoster: (settings.socialPoster as SocialPosterId) ?? "clipboard",
    photoSources: photoSourcesWithStatus,
    posters: postersWithStatus,
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as {
    listingPhotoProvider?: ListingPhotoProviderId;
    socialPoster?: SocialPosterId;
  } | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true },
  });
  const merged = {
    ...((account?.settingsJson as Record<string, unknown>) ?? {}),
  };
  if (body.listingPhotoProvider) {
    merged.listingPhotoProvider = body.listingPhotoProvider;
  }
  if (body.socialPoster) merged.socialPoster = body.socialPoster;

  await prisma.account.update({
    where: { id: actor.accountId },
    data: { settingsJson: merged as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({ ok: true });
}
