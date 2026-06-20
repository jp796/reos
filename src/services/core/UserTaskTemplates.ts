/**
 * UserTaskTemplates — apply a stored TaskTemplate's items to a deal.
 *
 * Mirrors applyChecklist (TaskTemplates.ts) but reads items from a
 * user/AI-defined TaskTemplate row instead of the built-in code
 * templates. Same rules: dedupe by title, derive dueAt from the related
 * milestone's date (offset before/after), never fabricate dates.
 */

import type { PrismaClient } from "@prisma/client";

export interface TaskTemplateItem {
  title: string;
  description?: string | null;
  assignedTo: "coordinator" | "agent" | "client" | "lender" | "title" | "inspector";
  priority: "low" | "normal" | "high" | "urgent";
  relatesToMilestone?: string | null;
  offsetFromMilestoneDays?: number | null;
  sideFilter?: "buy" | "sell" | "both" | null;
}

const ROLES = new Set(["coordinator", "agent", "client", "lender", "title", "inspector"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

/** Coerce arbitrary JSON (from AI or the editor) into safe items. */
export function normalizeItems(raw: unknown): TaskTemplateItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskTemplateItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 120) : "";
    if (!title) continue;
    const assignedTo = ROLES.has(String(o.assignedTo)) ? (o.assignedTo as TaskTemplateItem["assignedTo"]) : "coordinator";
    const priority = PRIORITIES.has(String(o.priority)) ? (o.priority as TaskTemplateItem["priority"]) : "normal";
    const off = Number(o.offsetFromMilestoneDays);
    out.push({
      title,
      description: typeof o.description === "string" ? o.description.slice(0, 500) : null,
      assignedTo,
      priority,
      relatesToMilestone: typeof o.relatesToMilestone === "string" ? o.relatesToMilestone : null,
      offsetFromMilestoneDays: Number.isFinite(off) ? off : null,
      sideFilter:
        o.sideFilter === "buy" || o.sideFilter === "sell" || o.sideFilter === "both"
          ? o.sideFilter
          : null,
    });
  }
  return out.slice(0, 60);
}

export async function applyTaskTemplateItems(
  db: PrismaClient,
  transactionId: string,
  items: TaskTemplateItem[],
  side: string | null,
): Promise<{ created: number; skipped: number }> {
  const [existing, milestones] = await Promise.all([
    db.task.findMany({ where: { transactionId }, select: { title: true } }),
    db.milestone.findMany({ where: { transactionId }, select: { type: true, dueAt: true } }),
  ]);
  const have = new Set(existing.map((t) => t.title.toLowerCase()));
  const milestonesByType = new Map(milestones.map((m) => [m.type, m.dueAt]));

  let created = 0;
  let skipped = 0;
  for (const t of items) {
    // Side filter (buy/sell). "both" or null applies to either.
    if (t.sideFilter && t.sideFilter !== "both" && side && t.sideFilter !== side) {
      skipped++;
      continue;
    }
    if (have.has(t.title.toLowerCase())) {
      skipped++;
      continue;
    }
    let dueAt: Date | null = null;
    if (t.relatesToMilestone) {
      const msDue = milestonesByType.get(t.relatesToMilestone);
      if (msDue) {
        const days = t.offsetFromMilestoneDays ?? 0;
        const d = new Date(msDue);
        d.setDate(d.getDate() - days); // positive = before, negative = after
        dueAt = d;
      }
    }
    await db.task.create({
      data: {
        transactionId,
        title: t.title,
        description: t.description ?? null,
        dueAt,
        assignedTo: t.assignedTo,
        priority: t.priority,
      },
    });
    created++;
    have.add(t.title.toLowerCase());
  }
  return { created, skipped };
}
