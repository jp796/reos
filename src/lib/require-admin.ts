/**
 * Server helper for /admin/* routes — gates access to REOS operators
 * (currently just JP). Operator identity is keyed off the same
 * AUTH_ALLOWED_EMAILS env var that the legacy single-tenant gate uses;
 * that list is intentionally narrow (1–2 emails) and stored in
 * Secret Manager.
 *
 * Returns the ActingUser on success, or a NextResponse (401/403) on
 * failure — call sites pattern is:
 *
 *   const op = await requireAdmin();
 *   if (op instanceof NextResponse) return op;
 *
 * Tenant customers (subscription="active" path through signIn) never
 * touch this — they're authenticated but not authorized for /admin.
 * That's intentional: customer-owners are owners of THEIR account,
 * not REOS-level operators.
 */

import { NextResponse } from "next/server";
import { requireSession, type ActingUser } from "./require-session";

function operatorEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin(): Promise<ActingUser | NextResponse> {
  const r = await requireSession();
  if (r instanceof NextResponse) return r;
  const ops = operatorEmails();
  if (!ops.includes(r.email.toLowerCase())) {
    return NextResponse.json(
      { error: "operator role required" },
      { status: 403 },
    );
  }
  return r;
}
