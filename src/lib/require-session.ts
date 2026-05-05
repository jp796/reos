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
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export interface ActingUser {
  userId: string;
  /**
   * The account the caller is currently acting under. May differ
   * from User.accountId when the user has switched into another
   * workspace via AccountMembership (a TC working under their
   * client's brokerage). Always the source of truth for tenant
   * scoping in queries.
   */
  accountId: string;
  /**
   * Role inside `accountId`. For the home account it comes from
   * User.role; for a memberships-based switch it comes from
   * AccountMembership.role.
   */
  role: "owner" | "coordinator" | string;
  email: string;
  name: string | null;
  /** True when the active account is NOT the user's home account. */
  isImpersonating: boolean;
  /** The user's home account (for switcher UI). */
  homeAccountId: string;
}

const ACTIVE_ACCOUNT_COOKIE = "reos_active_account";

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

  // accountId is nullable at the DB level to let NextAuth's adapter
  // create the User row (it only passes name/email/emailVerified).
  // Our createUser event fills this in immediately after, so in
  // steady state it's always populated. If we see null here, the
  // user is in a half-provisioned state — reject cleanly.
  if (!user.accountId) {
    return NextResponse.json(
      { error: "user not linked to an account" },
      { status: 401 },
    );
  }

  // ── Active workspace resolution ────────────────────────────────
  // A user can hold AccountMembership rows on accounts other than
  // their home one. The `reos_active_account` cookie selects which
  // one is "active" right now. Validate the cookie against the user's
  // home + accepted memberships before honoring it; an invalid value
  // silently falls back to the home account so a stale/spoofed cookie
  // can never escalate access.
  let activeAccountId = user.accountId;
  let activeRole = user.role;
  let isImpersonating = false;

  try {
    const jar = await cookies();
    const cookieAccount = jar.get(ACTIVE_ACCOUNT_COOKIE)?.value;
    if (cookieAccount && cookieAccount !== user.accountId) {
      // Verify membership exists, accepted, not revoked.
      const m = await prisma.accountMembership.findFirst({
        where: {
          userId: user.id,
          accountId: cookieAccount,
          revokedAt: null,
          acceptedAt: { not: null },
        },
        select: { role: true, accountId: true },
      });
      if (m) {
        activeAccountId = m.accountId;
        activeRole = m.role;
        isImpersonating = true;
      }
    }
  } catch {
    // No cookie store available (edge runtime path or test shim) —
    // stick with home account.
  }

  return {
    userId: user.id,
    accountId: activeAccountId,
    role: activeRole,
    email: user.email,
    name: user.name,
    isImpersonating,
    homeAccountId: user.accountId,
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
