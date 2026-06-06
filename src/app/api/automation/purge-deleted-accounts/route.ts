/**
 * POST /api/automation/purge-deleted-accounts
 *
 * Cron-driven. Hard-deletes any Account whose
 * deletionRequestedAt is older than the 30-day grace window.
 * Onboarded under middleware's WEBHOOK_PATTERNS via
 * /api/automation/*-tick — that matcher already exempts this
 * style from session auth — but we also enforce a shared secret
 * (SCAN_SCHEDULE_SECRET, same secret the other cron routes use).
 *
 * Cascade: Account has onDelete: Cascade on every tenant-owned
 * model (Contact, Transaction, Milestone, Document, etc.), so a
 * single delete row removes everything downstream. AccountMembership
 * rows go with it; the User row stays (NextAuth-managed) so the
 * email can sign up fresh later if they want.
 *
 * Idempotent: if no accounts qualify the response is { purged: 0 }.
 * Safe to invoke multiple times per day.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  // Shared-secret gate. We also accept the GitHub Actions / Cloud
  // Scheduler X-CloudScheduler header as a soft signal — the real
  // check is the secret.
  const header = req.headers.get("x-scan-secret") ?? "";
  if (!env.SCAN_SCHEDULE_SECRET || header !== env.SCAN_SCHEDULE_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - GRACE_MS);
  const eligible = await prisma.account.findMany({
    where: { deletionRequestedAt: { lt: cutoff, not: null } },
    select: { id: true, businessName: true, deletionRequestedAt: true },
  });

  const purged: Array<{ id: string; businessName: string; daysOverdue: number }> = [];
  for (const a of eligible) {
    try {
      // Detach any users whose home account is this one so we don't
      // orphan them (User.accountId is nullable). They keep their
      // sign-in identity but lose access until they re-sign-up.
      await prisma.user.updateMany({
        where: { accountId: a.id },
        data: { accountId: null },
      });
      await prisma.account.delete({ where: { id: a.id } });
      const daysOverdue = a.deletionRequestedAt
        ? Math.floor((Date.now() - a.deletionRequestedAt.getTime() - GRACE_MS) / (24*60*60*1000))
        : 0;
      purged.push({ id: a.id, businessName: a.businessName, daysOverdue });
    } catch (err) {
      logError(err, { route: "purge-deleted-accounts", accountId: a.id });
    }
  }

  return NextResponse.json({
    ok: true,
    cutoff: cutoff.toISOString(),
    purged: purged.length,
    details: purged,
  });
}
