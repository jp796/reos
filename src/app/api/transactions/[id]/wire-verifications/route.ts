/**
 * GET  /api/transactions/:id/wire-verifications  — list
 * POST /api/transactions/:id/wire-verifications  — log a verification
 *
 * POST body:
 *   {
 *     verifiedAt: ISO (required — when the call happened),
 *     titleAgentName?, phoneCalled?, instructionsSummary?, notes?
 *   }
 *
 * Every POST audit-stamped with the acting user's id so we can
 * reconstruct WHO verified later (liability proof).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireSession, assertSameAccount } from "@/lib/require-session";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({
    where: { id },
    select: { accountId: true },
  });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const rows = await prisma.wireVerification.findMany({
    where: { transactionId: id },
    orderBy: { verifiedAt: "desc" },
  });
  return NextResponse.json({ items: rows });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const actor = await requireSession();
  if (actor instanceof NextResponse) return actor;

  const { id } = await ctx.params;
  const txn = await prisma.transaction.findUnique({ where: { id } });
  if (!txn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const acctGuard = assertSameAccount(actor, txn.accountId);
  if (acctGuard) return acctGuard;

  const body = (await req.json().catch(() => null)) as {
    verifiedAt?: string;
    titleAgentName?: string;
    phoneCalled?: string;
    instructionsSummary?: string;
    notes?: string;
  } | null;
  if (!body?.verifiedAt) {
    return NextResponse.json(
      { error: "verifiedAt required (ISO date/time of the call)" },
      { status: 400 },
    );
  }
  const verifiedAt = new Date(body.verifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) {
    return NextResponse.json({ error: "invalid verifiedAt" }, { status: 400 });
  }

  // Reject if summary includes what looks like a full account number
  // (prevents accidental storage of sensitive banking data). 8+
  // consecutive digits = likely an account/routing number.
  const combined = `${body.instructionsSummary ?? ""} ${body.notes ?? ""}`;
  if (/\b\d{8,}\b/.test(combined)) {
    return NextResponse.json(
      {
        error:
          "Don't paste full account or routing numbers here — summarize (e.g. 'last 4 match 4823').",
      },
      { status: 400 },
    );
  }

  const created = await prisma.wireVerification.create({
    data: {
      transactionId: id,
      verifiedAt,
      verifiedByUserId: actor.userId,
      titleAgentName: body.titleAgentName?.trim().slice(0, 120) || null,
      phoneCalled: body.phoneCalled?.trim().slice(0, 30) || null,
      instructionsSummary:
        body.instructionsSummary?.trim().slice(0, 2000) || null,
      notes: body.notes?.trim().slice(0, 2000) || null,
    },
  });

  // Audit log — critical for CYA. Stamps WHO logged the verification.
  try {
    await prisma.automationAuditLog.create({
      data: {
        accountId: txn.accountId,
        transactionId: id,
        entityType: "wire_verification",
        entityId: created.id,
        ruleName: "wire_verification_logged",
        actionType: "create",
        sourceType: "manual",
        confidenceScore: 1.0,
        decision: "applied",
        beforeJson: Prisma.JsonNull,
        afterJson: {
          verifiedAt: verifiedAt.toISOString(),
          titleAgent: created.titleAgentName,
          phone: created.phoneCalled,
          // summary intentionally omitted from audit — it's already
          // in the wire_verifications table, no need to duplicate
        },
        actorUserId: actor.userId,
      },
    });
  } catch {
    // audit failure doesn't block the log
  }

  return NextResponse.json({ ok: true, verification: created });
}
