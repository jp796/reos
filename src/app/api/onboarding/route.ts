/**
 * GET  /api/onboarding   — current onboarding state (which steps done)
 * POST /api/onboarding   — save partial answers + advance flag
 *
 * Stored in Account.settingsJson.onboarding = {
 *   completedAt: ISO | null,
 *   step: number,
 *   brokerageProfileId, primaryState, calendarShareList,
 *   listingPhotoProvider, socialPoster
 * }
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/require-session";

interface OnboardingState {
  completedAt: string | null;
  step: number;
  brokerageProfileId?: string | null;
  primaryState?: string | null;
  calendarShareList?: string[];
  listingPhotoProvider?: string | null;
  socialPoster?: string | null;
}

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true, brokerageProfileId: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const onboarding = (settings.onboarding ?? {}) as OnboardingState;

  const profiles = await prisma.brokerageProfile.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, name: true, complianceSystem: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    state: {
      completedAt: onboarding.completedAt ?? null,
      step: onboarding.step ?? 0,
      brokerageProfileId:
        onboarding.brokerageProfileId ?? account?.brokerageProfileId ?? null,
      primaryState: onboarding.primaryState ?? null,
      calendarShareList: onboarding.calendarShareList ?? [],
      listingPhotoProvider: onboarding.listingPhotoProvider ?? null,
      socialPoster: onboarding.socialPoster ?? null,
    },
    profiles,
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const body = (await req.json().catch(() => null)) as Partial<
    OnboardingState & { complete?: boolean }
  > | null;
  if (!body) return NextResponse.json({ error: "bad JSON" }, { status: 400 });

  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  const prior = (settings.onboarding ?? {}) as OnboardingState;

  // Validated patch
  const next: OnboardingState = { ...prior, ...body, completedAt: prior.completedAt };
  if (typeof body.step === "number") next.step = body.step;
  if (body.complete) next.completedAt = new Date().toISOString();
  if (Array.isArray(body.calendarShareList)) {
    // sanitize emails
    next.calendarShareList = body.calendarShareList
      .map((e) => String(e).trim().toLowerCase().slice(0, 200))
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      .slice(0, 25);
  }

  // Cascade: when brokerageProfileId is set, also persist on the
  // account row so all transaction queries pick up the right profile.
  const accountPatch: Record<string, unknown> = {};
  if (
    body.brokerageProfileId !== undefined &&
    body.brokerageProfileId !== null
  ) {
    accountPatch.brokerageProfileId = body.brokerageProfileId;
  }
  if (
    body.listingPhotoProvider !== undefined &&
    body.listingPhotoProvider !== null
  ) {
    settings.listingPhotoProvider = body.listingPhotoProvider;
  }
  if (body.socialPoster !== undefined && body.socialPoster !== null) {
    settings.socialPoster = body.socialPoster;
  }
  settings.onboarding = next;

  await prisma.account.update({
    where: { id: actor.accountId },
    data: {
      settingsJson: settings as unknown as Prisma.InputJsonValue,
      ...accountPatch,
    },
  });

  return NextResponse.json({ ok: true, state: next });
}
