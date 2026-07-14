/**
 * POST   /api/integrations/ghl/connect  { token, locationId }
 *          → validate the GHL Private Integration token, store it encrypted
 *            on the Account with the location id. Owner-only.
 * DELETE /api/integrations/ghl/connect  → disconnect.
 *
 * The token is never returned; stored AES-256-GCM encrypted like the other
 * integration secrets.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";
import { GhlService } from "@/services/integrations/GhlService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  let body: { token?: string; locationId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const token = body.token?.trim();
  const locationId = body.locationId?.trim();
  if (!token || !locationId) {
    return NextResponse.json(
      { error: "GHL token and location id are required" },
      { status: 400 },
    );
  }

  // Validate the token with a lightweight search before saving.
  try {
    await new GhlService(token, locationId).searchContacts("test");
  } catch {
    return NextResponse.json(
      { error: "That token/location didn't work — check the Private Integration token has Contacts read scope." },
      { status: 422 },
    );
  }

  try {
    const blob = getEncryptionService().encrypt(token);
    await prisma.account.update({
      where: { id: actor.accountId },
      data: { ghlApiKeyEncrypted: blob, ghlLocationId: locationId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError(err, { route: "ghl.connect", accountId: actor.accountId });
    return NextResponse.json({ error: "Couldn't save the GHL connection." }, { status: 500 });
  }
}

export async function DELETE() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  await prisma.account.update({
    where: { id: actor.accountId },
    data: { ghlApiKeyEncrypted: null, ghlLocationId: null },
  });
  return NextResponse.json({ ok: true });
}
