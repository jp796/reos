/**
 * POST /api/onboarding/save-checklist
 *
 * Body (JSON):
 *   profileId: string         — BrokerageProfile to attach to (must
 *                               match the caller's account or be the
 *                               account's own brokerage profile)
 *   kind: "transaction" | "listing"
 *   slots: Array<{
 *     number: number,
 *     label: string,
 *     required: "required" | "if_applicable",
 *     tag: "cda" | "closing_docs" | "termination" | null,
 *   }>
 *
 * Replaces all rows for (profile, kind) with the supplied set. The
 * caller is the new brokerage owner during onboarding — only the
 * account's own brokerage profile is writable, never a profile owned
 * by a different tenant.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const slot = z.object({
  number: z.number().int().min(1).max(200),
  label: z.string().min(1).max(200),
  required: z.enum(["required", "if_applicable"]),
  tag: z
    .enum(["cda", "closing_docs", "termination"])
    .nullable()
    .optional()
    .default(null),
});

const body = z.object({
  profileId: z.string().min(1),
  kind: z.enum(["transaction", "listing"]),
  slots: z.array(slot).min(1).max(80),
});

/** Stable, URL-safe key derived from the label. Used as the slot_key
 * unique constraint so a brokerage can't accidentally insert two
 * differently-numbered rows for "Accepted Contract/Counters". */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  let parsed: z.infer<typeof body>;
  try {
    const json = await req.json();
    parsed = body.parse(json);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  // Authorization: the caller must own the account whose
  // brokerage profile they're editing. Defense-in-depth: even if the
  // client sent a foreign profileId, we reject unless it matches the
  // account's stored profileId.
  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { brokerageProfileId: true },
  });
  if (!account?.brokerageProfileId) {
    return NextResponse.json(
      { error: "account has no brokerage profile" },
      { status: 400 },
    );
  }
  if (account.brokerageProfileId !== parsed.profileId) {
    return NextResponse.json(
      { error: "cannot edit a different account's brokerage" },
      { status: 403 },
    );
  }

  // Replace-all-for-(profile,kind) in a single tx so a partial
  // failure leaves no orphan rows.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.brokerageChecklist.deleteMany({
        where: { profileId: parsed.profileId, kind: parsed.kind },
      });
      // Dedupe by slot_key so the unique constraint can't trip on
      // duplicate labels in the source screenshots.
      const seen = new Set<string>();
      const rows = parsed.slots
        .map((s) => ({
          profileId: parsed.profileId,
          kind: parsed.kind,
          slotNumber: s.number,
          slotKey: slugify(s.label) || `slot_${s.number}`,
          label: s.label,
          required: s.required,
          tag: s.tag ?? null,
          requiredFor: null,
          keywordsJson: [],
          stateCode: null,
        }))
        .filter((r) => {
          if (seen.has(r.slotKey)) return false;
          seen.add(r.slotKey);
          return true;
        });
      await tx.brokerageChecklist.createMany({ data: rows });
    });
  } catch (e) {
    logError(e, {
      route: "/api/onboarding/save-checklist",
      accountId: actor.accountId,
      userId: actor.userId,
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, count: parsed.slots.length });
}
