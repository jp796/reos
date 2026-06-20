/**
 * GET/POST /api/settings/summary-design
 *
 * Branding for the transaction-summary page (logo, accent color,
 * tagline). Stored in Account.settingsJson.summaryDesign — no migration.
 */

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

export interface SummaryDesign {
  logoUrl: string;
  accentColor: string;
  tagline: string;
}

function read(settings: Record<string, unknown>): SummaryDesign {
  const d = (settings.summaryDesign ?? {}) as Record<string, unknown>;
  return {
    logoUrl: typeof d.logoUrl === "string" ? d.logoUrl : "",
    accentColor: typeof d.accentColor === "string" ? d.accentColor : "#4F46E5",
    tagline: typeof d.tagline === "string" ? d.tagline : "",
  };
}

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true, businessName: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  return NextResponse.json({ ok: true, design: read(settings), businessName: account?.businessName ?? "" });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  let body: Partial<SummaryDesign>;
  try {
    body = (await req.json()) as Partial<SummaryDesign>;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const accent = String(body.accentColor ?? "").trim();
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    return NextResponse.json({ error: "accent must be a #RRGGBB hex" }, { status: 400 });
  }
  const account = await prisma.account.findUnique({
    where: { id: actor.accountId },
    select: { settingsJson: true },
  });
  const settings = (account?.settingsJson ?? {}) as Record<string, unknown>;
  settings.summaryDesign = {
    logoUrl: String(body.logoUrl ?? "").trim().slice(0, 500),
    accentColor: accent || "#4F46E5",
    tagline: String(body.tagline ?? "").trim().slice(0, 160),
  };
  await prisma.account.update({
    where: { id: actor.accountId },
    data: { settingsJson: settings as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json({ ok: true, design: read(settings) });
}
