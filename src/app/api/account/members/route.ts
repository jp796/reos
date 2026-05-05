/**
 * GET  /api/account/members  — list memberships for the active account
 * POST /api/account/members  — owner invites a new member by email
 *
 * Body for POST:
 *   { email: string, role?: "coordinator" | "agent" }
 *
 * The membership row is created in `pending` state (acceptedAt=null
 * if the user doesn't exist yet, or set immediately if their User row
 * is already on file). On first sign-in, auth.ts.createUser auto-
 * accepts any pending invites matching the email.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const invite = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(["coordinator", "agent"]).default("coordinator"),
});

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  const rows = await prisma.accountMembership.findMany({
    where: { accountId: actor.accountId, revokedAt: null },
    orderBy: { invitedAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    members: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      invitedAt: r.invitedAt.toISOString(),
      acceptedAt: r.acceptedAt?.toISOString() ?? null,
      user: r.user,
    })),
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  let body: z.infer<typeof invite>;
  try {
    body = invite.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  // If the user already has a row, link the membership immediately
  const existing = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });

  try {
    const row = await prisma.accountMembership.upsert({
      where: {
        // Composite unique on (accountId, email)
        accountId_email: { accountId: actor.accountId, email: body.email },
      },
      create: {
        accountId: actor.accountId,
        email: body.email,
        role: body.role,
        invitedById: actor.userId,
        userId: existing?.id ?? null,
        acceptedAt: existing ? new Date() : null,
      },
      update: {
        role: body.role,
        revokedAt: null,
        userId: existing?.id ?? null,
        acceptedAt: existing ? new Date() : null,
      },
    });

    return NextResponse.json({ ok: true, member: row });
  } catch (e) {
    logError(e, {
      route: "POST /api/account/members",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invite failed" },
      { status: 500 },
    );
  }
}
