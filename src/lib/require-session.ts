/**
 * Server-side auth helpers for API routes and server components.
 *
 * The middleware already gates unauthenticated requests at the edge.
 * These helpers exist so individual routes can:
 *   - get the acting user's id / account / role for audit stamping
 *   - gate sensitive actions behind role checks (owner vs coordinator)
 *   - double-check the session inside the Node runtime (defense in
 *     depth — cookie presence at the edge is not the same as a valid
 *     live session row)
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export interface ActingUser {
  userId: string;
  accountId: string;
  role: "owner" | "coordinator" | string;
  email: string;
  name: string | null;
}

/**
 * Resolve the current session + user. Returns the ActingUser on
 * success, or a NextResponse (401/403) on failure — call sites do:
 *
 *   const r = await requireSession();
 *   if (r instanceof NextResponse) return r;
 *   // r is ActingUser from here
 */
export async function requireSession(): Promise<ActingUser | NextResponse> {
  const session = await auth();
  const userEmail = session?.user?.email;
  if (!userEmail) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401 },
    );
  }

  // Re-read the user row so role + accountId reflect current state
  // (a revocation shouldn't wait for the session cookie to roll over).
  const user = await prisma.user.findUnique({
    where: { email: userEmail.toLowerCase() },
    select: {
      id: true,
      accountId: true,
      role: true,
      email: true,
      name: true,
    },
  });
  if (!user) {
    return NextResponse.json(
      { error: "user not found" },
      { status: 401 },
    );
  }

  return {
    userId: user.id,
    accountId: user.accountId,
    role: user.role,
    email: user.email,
    name: user.name,
  };
}

/**
 * Variant that additionally requires the acting user to be `owner`.
 * Coordinators (Vicki) get a 403. Use for destructive / admin actions
 * we don't want the TC to accidentally hit — e.g. delete account,
 * rotate OAuth tokens, change team membership.
 */
export async function requireOwner(): Promise<ActingUser | NextResponse> {
  const r = await requireSession();
  if (r instanceof NextResponse) return r;
  if (r.role !== "owner") {
    return NextResponse.json(
      { error: "forbidden", reason: "owner role required" },
      { status: 403 },
    );
  }
  return r;
}

/**
 * Assert the target row belongs to the acting user's account. Use in
 * routes that take an ID param and need to confirm the object is in
 * the caller's tenant before mutating it.
 *
 * Returns null if ok, or a 404 NextResponse if the ID is not in the
 * caller's account (we return 404 not 403 to avoid leaking existence).
 */
export function assertSameAccount(
  actor: ActingUser,
  rowAccountId: string | null | undefined,
): NextResponse | null {
  if (!rowAccountId || rowAccountId !== actor.accountId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return null;
}
