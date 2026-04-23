/**
 * POST /api/terms/accept
 * Body: none
 *
 * Stamps the current user's termsAcceptedAt to now. Idempotent —
 * calling it when already accepted just updates the timestamp.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/require-session";

export async function POST() {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const now = new Date();
  await prisma.user.update({
    where: { id: actor.userId },
    data: { termsAcceptedAt: now },
  });

  // Audit the acceptance — proof that this user agreed, with timestamp
  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: actor.accountId,
        entityType: "user",
        entityId: actor.userId,
        ruleName: "terms_acceptance",
        actionType: "update",
        sourceType: "manual",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: Prisma.JsonNull,
        afterJson: { termsAcceptedAt: now.toISOString(), email: actor.email },
        actorUserId: actor.userId,
      },
    });
  } catch {
    // audit failure does not block acceptance
  }

  return NextResponse.json({ ok: true, termsAcceptedAt: now.toISOString() });
}
