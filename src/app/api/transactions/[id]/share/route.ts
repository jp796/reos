/**
 * POST   /api/transactions/:id/share   — create / rotate a share token
 * DELETE /api/transactions/:id/share   — revoke the share
 *
 * Token format: 32 url-safe base62-ish chars. Expiry defaults to
 * 180 days from creation (override via body.days).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";

function makeToken(): string {
  // 18 bytes of entropy → 24 base64-url chars. Plenty unguessable.
  return randomBytes(18).toString("base64url");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { days?: number };
  const days = Math.min(Math.max(body?.days ?? 180, 1), 3650);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Rotate token on every POST — old link is dead, new one takes its place.
  const token = makeToken();
  await prisma.transaction.update({
    where: { id },
    data: {
      shareToken: token,
      shareCreatedAt: now,
      shareExpiresAt: expiresAt,
    },
  });

  return NextResponse.json({
    ok: true,
    token,
    path: `/share/timeline/${token}`,
    expiresAt: expiresAt.toISOString(),
  });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.transaction.update({
    where: { id },
    data: {
      shareToken: null,
      shareExpiresAt: null,
    },
  });
  return NextResponse.json({ ok: true });
}
