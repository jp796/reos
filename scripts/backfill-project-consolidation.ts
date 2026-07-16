/**
 * scripts/backfill-project-consolidation.ts
 *
 * FLAG-1 consolidation safety net. After the project-phase stages (Rehab,
 * Prep-to-List, Renovations, Lease-Up, Refinance) were removed from the flat
 * strategyTemplates, any IN-FLIGHT deal whose Asset.currentStageName still
 * points at one of those stages would have a dangling pointer. This migrates
 * them NON-DESTRUCTIVELY:
 *
 *   - project-phase stages → create a bare Project and RE-PARENT the deal's
 *     existing incomplete stage tasks onto it (set projectId + relabel stageKey
 *     to the project's first phase). No task is dropped, no template task is
 *     re-instantiated (so no double-up). currentStageName → the project phase.
 *   - disposition stages (flip on_market/pending/sold) → clear currentStageName
 *     (tasks preserved) and LOG for manual re-disposition — we don't guess.
 *
 * Idempotent (skips assets that already have an active project). Dry-run by
 * default; pass --apply to write. Scope with --account=<id>.
 *
 * Run: node --env-file=.env --import tsx scripts/backfill-project-consolidation.ts [--apply] [--account=<id>]
 */

import { PrismaClient } from "@prisma/client";
import { getProjectTemplate } from "@/services/core/projectTemplates";
import type { Strategy } from "@/services/core/DealClassifierService";

const PROJECT_PHASE_REMOVED: Record<string, string[]> = {
  flip: ["rehab", "prep_to_list"],
  rental_brrrr: ["renovations", "lease_up", "refinance"],
};
const DISPOSITION_REMOVED: Record<string, string[]> = {
  flip: ["on_market", "pending", "sold"],
};

const DAY_MS = 86_400_000;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const accountArg = args.find((a) => a.startsWith("--account="));
  const accountId = accountArg ? accountArg.split("=")[1] : null;
  const db = new PrismaClient();

  const removedStages = [
    ...new Set([...Object.values(PROJECT_PHASE_REMOVED).flat(), ...Object.values(DISPOSITION_REMOVED).flat()]),
  ];

  const assets = await db.asset.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      currentStageName: { in: removedStages },
    },
    select: { id: true, accountId: true, strategy: true, currentStageName: true },
  });

  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${assets.length} asset(s) sitting in a removed stage.`);
  let migratedToProject = 0;
  let clearedDisposition = 0;

  for (const a of assets) {
    const strategy = a.strategy as Strategy;
    const stage = a.currentStageName!;
    const inProjectPhase = (PROJECT_PHASE_REMOVED[strategy] ?? []).includes(stage);
    const inDisposition = (DISPOSITION_REMOVED[strategy] ?? []).includes(stage);

    if (inProjectPhase) {
      const existing = await db.project.findFirst({ where: { assetId: a.id, status: "active" }, select: { id: true } });
      if (existing) {
        console.log(`  · ${a.id} (${strategy}/${stage}) — already has an active project, skipping`);
        continue;
      }
      const tpl = getProjectTemplate(strategy);
      const firstPhase = tpl?.phases[0]?.key ?? "project";
      const removed = PROJECT_PHASE_REMOVED[strategy] ?? [];
      const orphanTasks = await db.task.count({ where: { assetId: a.id, stageKey: { in: removed }, completedAt: null } });
      console.log(`  → ${a.id} (${strategy}/${stage}) — migrate to Project, re-parent ${orphanTasks} in-flight task(s) → phase "${firstPhase}"`);
      if (apply && tpl) {
        const start = new Date();
        const project = await db.project.create({
          data: {
            assetId: a.id, accountId: a.accountId, type: tpl.projectType, status: "active",
            projectTemplateKey: tpl.key, startedAt: start,
            targetCompletionAt: new Date(start.getTime() + tpl.totalDays * DAY_MS),
          },
          select: { id: true },
        });
        // Re-parent existing stage tasks (preserve, relabel) — never re-instantiate.
        await db.task.updateMany({
          where: { assetId: a.id, stageKey: { in: removed } },
          data: { projectId: project.id, stageKey: firstPhase },
        });
        await db.asset.update({ where: { id: a.id }, data: { currentStageName: firstPhase } });
      }
      migratedToProject++;
    } else if (inDisposition) {
      console.log(`  ⚠ ${a.id} (${strategy}/${stage}) — was in a disposition stage; clearing pointer (tasks preserved), re-run disposition manually`);
      if (apply) {
        await db.asset.update({ where: { id: a.id }, data: { currentStageName: null } });
      }
      clearedDisposition++;
    }
  }

  console.log(`\n${apply ? "Migrated" : "Would migrate"}: ${migratedToProject} → Project · ${clearedDisposition} disposition pointer(s) cleared.`);
  if (!apply) console.log("Dry run — nothing written. Re-run with --apply.");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
