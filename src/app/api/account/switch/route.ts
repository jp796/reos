/**
 * POST /api/account/switch
 * Body: { accountId: string }
 *
 * Sets the `reos_active_account` cookie so subsequent requests run
 * under that workspace. Refuses any account the caller doesn't own
 * or have an accepted, non-revoked AccountMembership for.
 *
 * GET /api/account/switch
 *   Returns the user's available workspaces (home + memberships).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

const ACTIVE_ACCOUNT_COOKIE = "reos_active_account";

const body = z.object({ accountId: z.string().min(1) });

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const home = await prisma.account.findUnique({
    where: { id: actor.homeAccountId },
    select: { id: true, businessName: true },
  });
  const memberships = await prisma.accountMembership.findMany({
    where: {
      userId: actor.userId,
      revokedAt: null,
      acceptedAt: { not: null },
    },
    include: { account: { select: { id: true, businessName: true } } },
  });

  const workspaces = [
    home && {
      accountId: home.id,
      businessName: home.businessName,
      role: "owner",
      isHome: true,
    },
    ...memberships
      .filter((m) => m.accountId !== actor.homeAccountId)
      .map((m) => ({
        accountId: m.account.id,
        businessName: m.account.businessName,
        role: m.role,
        isHome: false,
      })),
  ].filter(Boolean);

  return NextResponse.json({
    ok: true,
    activeAccountId: actor.accountId,
    workspaces,
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  const targetAccountId = parsed.accountId;

  // Allow switching to home account at any time (clears cookie).
  if (targetAccountId === actor.homeAccountId) {
    const jar = await cookies();
    jar.delete(ACTIVE_ACCOUNT_COOKIE);
    return NextResponse.json({ ok: true, activeAccountId: targetAccountId });
  }

  // Otherwise the user must have an accepted, non-revoked membership.
  const m = await prisma.accountMembership.findFirst({
    where: {
      userId: actor.userId,
      accountId: targetAccountId,
      revokedAt: null,
      acceptedAt: { not: null },
    },
    select: { id: true },
  });
  if (!m) {
    return NextResponse.json(
      { error: "no membership for that account" },
      { status: 403 },
    );
  }

  const jar = await cookies();
  jar.set({
    name: ACTIVE_ACCOUNT_COOKIE,
    value: targetAccountId,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    // 30 days — long enough that a TC working on a long deal doesn't
    // get bumped out of the workspace by a normal cookie expiry.
    maxAge: 30 * 24 * 60 * 60,
  });
  return NextResponse.json({ ok: true, activeAccountId: targetAccountId });
}
