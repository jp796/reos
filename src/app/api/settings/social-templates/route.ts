/**
 * /api/settings/social-templates
 *
 * GET  — list all social-post templates for the caller's account
 *        (one row per event × platform combo, when populated)
 *
 * PUT  — bulk-save the user's matrix of templates. Body shape:
 *          { templates: [{ event, platform, body }, ...] }
 *        Empty body strings are treated as "delete this slot"
 *        so the AI path takes over for that platform again.
 *
 * Matrix approach (single bulk endpoint) keeps the settings form
 * dead simple — one save button, no per-row optimistic state.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";

const VALID_EVENTS = new Set(["new_listing", "under_contract", "sold"]);
const VALID_PLATFORMS = new Set(["instagram", "facebook", "linkedin"]);

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const rows = await prisma.socialPostTemplate.findMany({
    where: { accountId: actor.accountId },
    orderBy: [{ event: "asc" }, { platform: "asc" }],
  });
  return NextResponse.json({
    templates: rows.map((r) => ({
      event: r.event,
      platform: r.platform,
      body: r.body,
      isStarter: r.isStarter,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

export async function PUT(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  let body: { templates?: Array<{ event?: string; platform?: string; body?: string }> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const items = Array.isArray(body.templates) ? body.templates : [];

  // Validate every row up front — fail loudly rather than half-saving.
  for (const t of items) {
    if (!t.event || !VALID_EVENTS.has(t.event)) {
      return NextResponse.json(
        { error: `invalid event: ${t.event}` },
        { status: 400 },
      );
    }
    if (!t.platform || !VALID_PLATFORMS.has(t.platform)) {
      return NextResponse.json(
        { error: `invalid platform: ${t.platform}` },
        { status: 400 },
      );
    }
  }

  // Single transaction so partial writes can't leave the matrix in
  // a confusing state if the connection drops mid-save.
  await prisma.$transaction(async (tx) => {
    for (const t of items) {
      const event = t.event as string;
      const platform = t.platform as string;
      const trimmed = (t.body ?? "").trim();
      if (trimmed === "") {
        // Empty = explicit "go back to AI for this slot".
        await tx.socialPostTemplate.deleteMany({
          where: { accountId: actor.accountId, event, platform },
        });
        continue;
      }
      await tx.socialPostTemplate.upsert({
        where: {
          accountId_event_platform: {
            accountId: actor.accountId,
            event,
            platform,
          },
        },
        update: { body: trimmed, isStarter: false },
        create: {
          accountId: actor.accountId,
          event,
          platform,
          body: trimmed,
          isStarter: false,
        },
      });
    }
  });

  return NextResponse.json({ ok: true, savedCount: items.length });
}
