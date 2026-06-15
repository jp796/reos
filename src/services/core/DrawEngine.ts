/**
 * DrawEngine — rehab draw lifecycle (spec §7). A draw moves
 * requested → verified (photos) → released → paid, and CANNOT be
 * released until a lien waiver is attached (the gate). Retainage
 * (~10%) is withheld from each release and freed at punch-list.
 *
 * Pure helpers (computeRelease, canRelease) are unit-tested; the DB
 * transitions enforce the same rules against Prisma.
 */

import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type DrawStatus =
  | "requested"
  | "verified"
  | "released"
  | "paid";

/** Split a draw amount into net release + retainage held. */
export function computeRelease(
  amount: number,
  retainagePercent: number,
): { net: number; retainageHeld: number } {
  const pct = Math.max(0, Math.min(100, retainagePercent)) / 100;
  const retainageHeld = r2(amount * pct);
  return { net: r2(amount - retainageHeld), retainageHeld };
}

/** The lien-waiver gate (spec §7): a draw can only be released after
 *  it's verified AND a lien waiver is attached. */
export function canRelease(draw: {
  status: string;
  lienWaiverDocId: string | null;
  verifiedAt: Date | null;
}): { ok: boolean; reason?: string } {
  if (draw.status === "released" || draw.status === "paid") {
    return { ok: false, reason: "already_released" };
  }
  if (!draw.verifiedAt) return { ok: false, reason: "not_verified" };
  if (!draw.lienWaiverDocId) return { ok: false, reason: "lien_waiver_required" };
  return { ok: true };
}

export async function getOrCreateSchedule(
  db: Db,
  opts: { assetId: string; accountId: string; totalBudget?: number | null },
): Promise<string> {
  const existing = await db.drawSchedule.findFirst({
    where: { assetId: opts.assetId, status: "active" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.drawSchedule.create({
    data: {
      assetId: opts.assetId,
      accountId: opts.accountId,
      totalBudget: opts.totalBudget ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

export async function requestDraw(
  db: Db,
  opts: {
    drawScheduleId: string;
    assetId: string;
    milestone: string;
    amount: number;
  },
) {
  return db.draw.create({
    data: {
      drawScheduleId: opts.drawScheduleId,
      assetId: opts.assetId,
      milestone: opts.milestone,
      amount: opts.amount,
      status: "requested",
      requestedAt: new Date(),
    },
  });
}

export async function verifyDraw(
  db: Db,
  opts: { drawId: string; photos?: string[] },
) {
  return db.draw.update({
    where: { id: opts.drawId },
    data: {
      status: "verified",
      verifiedAt: new Date(),
      verifyPhotosJson: opts.photos ?? undefined,
    },
  });
}

export async function attachLienWaiver(
  db: Db,
  opts: { drawId: string; docId: string },
) {
  return db.draw.update({
    where: { id: opts.drawId },
    data: { lienWaiverDocId: opts.docId },
  });
}

/**
 * Release a draw — enforces the lien-waiver gate and withholds
 * retainage. Returns a discriminated result so the API can surface a
 * clean 409 when the gate blocks.
 */
export async function releaseDraw(
  db: Db,
  opts: { drawId: string; lenderReleaseRef?: string },
): Promise<
  | { ok: true; net: number; retainageHeld: number }
  | { ok: false; reason: string }
> {
  const draw = await db.draw.findUnique({
    where: { id: opts.drawId },
    select: {
      status: true,
      lienWaiverDocId: true,
      verifiedAt: true,
      amount: true,
      schedule: { select: { retainagePercent: true } },
    },
  });
  if (!draw) return { ok: false, reason: "not_found" };
  const gate = canRelease(draw);
  if (!gate.ok) return { ok: false, reason: gate.reason ?? "blocked" };

  const { net, retainageHeld } = computeRelease(
    draw.amount,
    draw.schedule.retainagePercent,
  );
  await db.draw.update({
    where: { id: opts.drawId },
    data: {
      status: "released",
      releasedAt: new Date(),
      retainageHeld,
      lenderReleaseRef: opts.lenderReleaseRef ?? undefined,
    },
  });
  return { ok: true, net, retainageHeld };
}

export async function markPaid(db: Db, opts: { drawId: string }) {
  return db.draw.update({
    where: { id: opts.drawId },
    data: { status: "paid", paidAt: new Date() },
  });
}

/** Release retainage at punch-list: total held across the schedule's
 *  draws, and mark the schedule complete. */
export async function releaseRetainage(
  db: Db,
  opts: { drawScheduleId: string },
): Promise<{ totalRetainage: number }> {
  const draws = await db.draw.findMany({
    where: { drawScheduleId: opts.drawScheduleId },
    select: { retainageHeld: true },
  });
  const totalRetainage = r2(
    draws.reduce((s, d) => s + (d.retainageHeld ?? 0), 0),
  );
  await db.drawSchedule.update({
    where: { id: opts.drawScheduleId },
    data: { status: "complete" },
  });
  return { totalRetainage };
}
