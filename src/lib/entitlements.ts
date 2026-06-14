/**
 * Entitlements — investor-module capability flags (spec §1).
 *
 * Distinct from tier-gate.ts: subscriptionTier gates BILLING (free <
 * solo < team < brokerage); entitlements gate WHICH PRODUCT SURFACES an
 * account sees (retail TC vs. investor module). They're orthogonal — an
 * agent-investor on the team tier holds BOTH entitlements.
 *
 * SAFETY: Account.entitlementsJson is null for every account that
 * existed before Phase 0. We treat null as ["retail_tc"] so the entire
 * current customer base keeps exactly the surfaces they have today. The
 * investor surfaces only appear once "investor" is explicitly granted.
 *
 * Usage (UI conditional):
 *   const ents = await readEntitlements(actor.accountId);
 *   if (ents.includes("investor")) { ...render investor board... }
 *
 * Usage (API guard):
 *   const gate = await requireEntitlement(actor.accountId, "investor");
 *   if (gate instanceof NextResponse) return gate;  // 403 if denied
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type Entitlement = "retail_tc" | "investor";

const ALL: readonly Entitlement[] = ["retail_tc", "investor"];

/** Default for any account with no explicit entitlements set (i.e. every
 * account created before the investor module shipped). */
export const DEFAULT_ENTITLEMENTS: Entitlement[] = ["retail_tc"];

/** Coerce an unknown JSON blob into a clean, deduped Entitlement[]. An
 * empty or invalid value falls back to the retail default so we never
 * lock an account out of every surface. */
export function normalizeEntitlements(raw: unknown): Entitlement[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ENTITLEMENTS];
  const valid = raw.filter(
    (x): x is Entitlement => typeof x === "string" && ALL.includes(x as Entitlement),
  );
  const deduped = Array.from(new Set(valid));
  return deduped.length > 0 ? deduped : [...DEFAULT_ENTITLEMENTS];
}

/** Read an account's entitlements (null → ["retail_tc"]). */
export async function readEntitlements(
  accountId: string,
): Promise<Entitlement[]> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { entitlementsJson: true },
  });
  return normalizeEntitlements(account?.entitlementsJson ?? null);
}

/** True when the account holds the given entitlement. */
export async function hasEntitlement(
  accountId: string,
  entitlement: Entitlement,
): Promise<boolean> {
  const ents = await readEntitlements(accountId);
  return ents.includes(entitlement);
}

/** API guard — returns a 403 NextResponse when the account lacks the
 * entitlement, else the resolved entitlement list. */
export async function requireEntitlement(
  accountId: string,
  entitlement: Entitlement,
): Promise<NextResponse | { entitlements: Entitlement[] }> {
  const entitlements = await readEntitlements(accountId);
  if (!entitlements.includes(entitlement)) {
    return NextResponse.json(
      {
        error: "entitlement_required",
        message: `This feature requires the "${entitlement}" entitlement.`,
        required: entitlement,
        current: entitlements,
      },
      { status: 403 },
    );
  }
  return { entitlements };
}
