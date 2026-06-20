/**
 * GET  /api/task-templates       — list this account's task templates
 * POST /api/task-templates       — create one { name, description?, items, source? }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { normalizeItems } from "@/services/core/UserTaskTemplates";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  source: z.enum(["manual", "ai"]).optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1),
});

export async function GET() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  const rows = await prisma.taskTemplate.findMany({
    where: { accountId: actor.accountId },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({
    ok: true,
    templates: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      source: r.source,
      itemCount: Array.isArray(r.itemsJson) ? r.itemsJson.length : 0,
      items: r.itemsJson,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }
  const items = normalizeItems(body.items);
  if (items.length === 0) {
    return NextResponse.json({ error: "no valid items" }, { status: 400 });
  }
  try {
    const row = await prisma.taskTemplate.create({
      data: {
        accountId: actor.accountId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        source: body.source ?? "manual",
        createdByUserId: actor.userId,
        itemsJson: items as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    logError(e, { route: "POST /api/task-templates", accountId: actor.accountId });
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
