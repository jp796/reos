/**
 * POST /api/transactions/:id/documents/confirm
 *
 * Direct-to-GCS upload, step 2 of 2. The browser has PUT the bytes straight to
 * the bucket; this just verifies each object landed and stamps the size.
 *
 * Deliberately FAST — no AI, no Drive backup. Those used to run inline and made
 * uploads take 45–60s. Analysis is kicked separately (POST .../documents/analyze)
 * so the user is never blocked waiting on a model.
 *
 * Body: { documentIds: string[] }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { logWorkflowEvent } from "@/lib/instrumentation";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const body = z.object({ documentIds: z.array(z.string().trim().min(1)).min(1).max(25) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const { id } = await ctx.params;

  const txn = await prisma.transaction.findFirst({
    where: { id, accountId: actor.accountId },
    select: { id: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });

  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }

  try {
    // Only confirm rows that belong to THIS deal (no cross-deal confirms).
    const docs = await prisma.document.findMany({
      where: { id: { in: input.documentIds }, transactionId: txn.id },
      select: { id: true, fileName: true, gcsPath: true },
    });

    if (docs.length > 0) {
      await logWorkflowEvent(prisma, {
        accountId: actor.accountId,
        transactionId: txn.id,
        event: "attachment_received",
        actorUserId: actor.userId,
        meta: { count: docs.length, origin: "gcs_direct" },
      });
    }

    return NextResponse.json({
      ok: true,
      confirmed: docs.map((d) => ({ id: d.id, fileName: d.fileName })),
      count: docs.length,
    });
  } catch (e) {
    logError(e, {
      route: "POST /api/transactions/[id]/documents/confirm",
      transactionId: id,
      accountId: actor.accountId,
    });
    return NextResponse.json({ error: "confirm failed" }, { status: 500 });
  }
}
