/**
 * POST /api/account/entitlements — owner-only. Toggle the investor
 * module on/off for this account (spec §1).
 *
 * Body: { investor: boolean }
 *
 * retail_tc is always preserved — turning the investor module off must
 * never strip an account of its base TC surface. The result is always a
 * non-empty, normalized entitlement set (see lib/entitlements.ts).
 *
 * GET — returns the current entitlements for the account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import {
  readEntitlements,
  normalizeEntitlements,
  type Entitlement,
} from "@/lib/entitlements";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const entitlements = await readEntitlements(actor.accountId);
  return NextResponse.json({ entitlements });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  if (actor.role !== "owner") {
    return NextResponse.json(
      { error: "forbidden", message: "Only the account owner can change entitlements." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as { investor?: unknown } | null;
  if (typeof body?.investor !== "boolean") {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be { investor: boolean }." },
      { status: 400 },
    );
  }

  const current = await readEntitlements(actor.accountId);
  const set = new Set<Entitlement>(current);
  // retail_tc is the floor — never removed by this toggle.
  set.add("retail_tc");
  if (body.investor) set.add("investor");
  else set.delete("investor");

  const next = normalizeEntitlements(Array.from(set));
  await prisma.account.update({
    where: { id: actor.accountId },
    data: { entitlementsJson: next },
  });

  return NextResponse.json({ ok: true, entitlements: next });
}
