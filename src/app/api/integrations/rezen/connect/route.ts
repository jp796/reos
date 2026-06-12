/**
 * POST   /api/integrations/rezen/connect  { usernameOrEmail, password }
 *          → sign in to Real (keymaker), store the JWT encrypted on
 *            the Account. Owner-only.
 * DELETE /api/integrations/rezen/connect
 *          → disconnect (clear the stored token).
 *
 * We never store the password — only the resulting JWT + userId,
 * encrypted at rest (AES-256-GCM, same envelope as Gmail/Meta tokens).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/require-session";
import { getEncryptionService } from "@/lib/encryption";
import { signIn, RealApiError } from "@/services/integrations/RealApiService";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;

  let body: { usernameOrEmail?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const usernameOrEmail = body.usernameOrEmail?.trim();
  const password = body.password ?? "";
  if (!usernameOrEmail || !password) {
    return NextResponse.json(
      { error: "usernameOrEmail and password required" },
      { status: 400 },
    );
  }

  try {
    const result = await signIn(usernameOrEmail, password);

    if (result.forceMfa || !result.accessToken) {
      return NextResponse.json(
        {
          error: result.forceMfa
            ? "Your Real account has MFA enabled. MFA login isn't supported by REOS yet — disable MFA temporarily or contact us."
            : result.errorMessage ?? "Sign-in returned no token",
        },
        { status: 422 },
      );
    }

    const enc = getEncryptionService();
    const blob = enc.encrypt(
      JSON.stringify({
        accessToken: result.accessToken,
        userId: result.userId,
        email: result.email,
        connectedAt: new Date().toISOString(),
      }),
    );
    await prisma.account.update({
      where: { id: actor.accountId },
      data: { realApiTokensEncrypted: blob },
    });

    return NextResponse.json({
      ok: true,
      email: result.email,
      userId: result.userId,
    });
  } catch (err) {
    if (err instanceof RealApiError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status === 401 ? 401 : 502 },
      );
    }
    logError(err, { route: "rezen.connect", accountId: actor.accountId });
    return NextResponse.json(
      { error: "Couldn't reach Real — try again." },
      { status: 502 },
    );
  }
}

export async function DELETE() {
  const actor = await requireOwner();
  if (actor instanceof NextResponse) return actor;
  await prisma.account.update({
    where: { id: actor.accountId },
    data: { realApiTokensEncrypted: null },
  });
  return NextResponse.json({ ok: true });
}
