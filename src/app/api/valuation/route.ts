/**
 * Example REOS API route: POST a set of valuation opinions, get the blend back.
 * Next.js App Router. Wire your Prisma singleton + auth as needed.
 *
 *   POST /api/valuation
 *   body: {
 *     address?: string,
 *     targetCondition?: string,           // e.g. "C3"
 *     engine?: number, rpr_rvm?: number,  // any subset of sources
 *     zillow?: number, redfin?: number, realtor?: number, manual?: number
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { buildSources, blend, type SourceKey } from "@/lib/valuation/blend";

const SOURCE_KEYS: SourceKey[] = [
  "engine",
  "rpr_rvm",
  "zillow",
  "redfin",
  "realtor",
  "manual",
];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const input: Partial<Record<SourceKey, number>> = {};
  for (const key of SOURCE_KEYS) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === "number") input[key] = v;
  }

  if (Object.keys(input).length === 0) {
    return NextResponse.json(
      { error: "provide at least one source value (engine, rpr_rvm, …)" },
      { status: 400 },
    );
  }

  try {
    const result = blend(buildSources(input), {
      targetCondition: typeof body.targetCondition === "string" ? body.targetCondition : undefined,
    });
    // To persist: import prisma + saveRun and call it here with a propertyId.
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "blend failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
