/**
 * PATCH /api/assets/:id/draws/:drawId — advance a draw through its
 * lifecycle (spec §7).
 *   Body: { action: "verify" | "lien_waiver" | "release" | "pay"
 *                   | "release_retainage",
 *           photos?: string[], docId?: string, lenderReleaseRef?: string }
 *
 * "release" enforces the lien-waiver gate (409 when blocked).
 * Tenancy: the draw's Asset must belong to the caller's account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import {
  verifyDraw,
  attachLienWaiver,
  releaseDraw,
  markPaid,
  releaseRetainage,
} from "@/services/core/DrawEngine";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; drawId: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id, drawId } = await ctx.params;

  // Tenancy — the draw belongs to this asset, which belongs to the account.
  const draw = await prisma.draw.findFirst({
    where: { id: drawId, assetId: id, asset: { accountId: actor.accountId } },
    select: { id: true, drawScheduleId: true },
  });
  if (!draw) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    photos?: string[];
    docId?: string;
    lenderReleaseRef?: string;
  } | null;

  switch (body?.action) {
    case "verify":
      return NextResponse.json({
        ok: true,
        draw: await verifyDraw(prisma, { drawId, photos: body.photos }),
      });
    case "lien_waiver":
      if (!body.docId) {
        return NextResponse.json({ error: "docId required" }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        draw: await attachLienWaiver(prisma, { drawId, docId: body.docId }),
      });
    case "release": {
      const r = await releaseDraw(prisma, {
        drawId,
        lenderReleaseRef: body.lenderReleaseRef,
      });
      if (!r.ok) {
        return NextResponse.json(
          { error: "gate_blocked", reason: r.reason },
          { status: 409 },
        );
      }
      return NextResponse.json({ ...r });
    }
    case "pay":
      return NextResponse.json({
        ok: true,
        draw: await markPaid(prisma, { drawId }),
      });
    case "release_retainage":
      return NextResponse.json({
        ok: true,
        ...(await releaseRetainage(prisma, {
          drawScheduleId: draw.drawScheduleId,
        })),
      });
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
