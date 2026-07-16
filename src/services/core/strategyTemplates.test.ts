/**
 * Tests for strategyTemplates (spec §6.2 Wholesale + engine helpers).
 * Run with:  bun tsx src/services/core/strategyTemplates.test.ts
 */

import {
  getStrategyTemplate,
  hasStageLifecycle,
  firstStage,
  stageByKey,
  nextStage,
  humanTasks,
  marketEntryStage,
  hasReachedMarketEntry,
} from "./strategyTemplates";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("strategyTemplates — §6.2 Wholesale");

check("wholesale has exactly 5 stages in order", () => {
  const stages = getStrategyTemplate("wholesale");
  assert(stages.length === 5, `got ${stages.length} stages`);
  stages.forEach((s, i) => assert(s.order === i, `stage ${i} order=${s.order}`));
});

check("retail has no stage lifecycle", () => {
  assert(!hasStageLifecycle("retail"), "retail should have no lifecycle");
  assert(getStrategyTemplate("retail").length === 0, "retail empty");
});

check("wholesale has a stage lifecycle", () => {
  assert(hasStageLifecycle("wholesale"), "wholesale should have a lifecycle");
});

check("first stage is lead_analysis", () => {
  const s = firstStage("wholesale");
  assert(s?.key === "lead_analysis", `first=${s?.key}`);
});

check("nextStage walks the lifecycle and stops at the end", () => {
  assert(nextStage("wholesale", "lead_analysis")?.key === "under_contract", "1→2");
  assert(nextStage("wholesale", "under_contract")?.key === "disposition", "2→3");
  assert(nextStage("wholesale", "disposition")?.key === "assignment_close", "3→4");
  assert(nextStage("wholesale", "assignment_close")?.key === "closed", "4→5");
  assert(nextStage("wholesale", "closed") === null, "5→end is null");
});

check("stageByKey resolves and misses cleanly", () => {
  assert(stageByKey("wholesale", "disposition")?.name.includes("Disposition"), "found");
  assert(stageByKey("wholesale", "nope") === null, "miss → null");
});

check("under_contract stage marks assignment-clause + auto Drive/Chat", () => {
  const s = stageByKey("wholesale", "under_contract");
  assert(!!s, "stage exists");
  assert(
    s!.tasks.some((t) => t.key === "confirm_assignment_clause"),
    "has confirm-assignment-clause task",
  );
  const auto = s!.tasks.find((t) => t.key === "scaffold_drive_chat");
  assert(auto?.auto === true, "Drive/Chat scaffold is an auto task");
});

check("humanTasks filters out auto/system tasks", () => {
  const s = stageByKey("wholesale", "closed")!;
  const human = humanTasks(s);
  assert(
    human.every((t) => !t.auto),
    "no auto tasks in humanTasks",
  );
  assert(
    human.length < s.tasks.length,
    "closed stage has at least one auto task filtered",
  );
});

check("every task key is unique within its stage", () => {
  for (const s of getStrategyTemplate("wholesale")) {
    const keys = s.tasks.map((t) => t.key);
    assert(new Set(keys).size === keys.length, `dup key in ${s.key}`);
  }
});

check("consolidated flat lifecycles: flip=2 (acquisition), rental=3, creative=6", () => {
  // FLAG 1: rehab/prep (flip) and reno/lease-up/refi (rental) moved to the
  // Project, so the flat templates keep only transaction-phase stages.
  assert(getStrategyTemplate("flip").length === 2, "flip 2");
  assert(getStrategyTemplate("rental_brrrr").length === 3, "rental 3");
  assert(getStrategyTemplate("creative").length === 6, "creative 6");
});

check("all investor strategies have lifecycles; retail does not", () => {
  for (const s of ["wholesale", "flip", "rental_brrrr", "creative"] as const) {
    assert(hasStageLifecycle(s), `${s} should have a lifecycle`);
  }
  assert(!hasStageLifecycle("retail"), "retail none");
});

check("rental Under-Management and creative Loan-Servicing are recurring", () => {
  assert(stageByKey("rental_brrrr", "under_management")?.isRecurring === true, "rental recurring");
  assert(stageByKey("creative", "loan_servicing_hold")?.isRecurring === true, "creative recurring");
});

check("every stage order is contiguous 0..n-1 for all strategies", () => {
  for (const s of ["wholesale", "flip", "rental_brrrr", "creative"] as const) {
    getStrategyTemplate(s).forEach((stage, i) =>
      assert(stage.order === i, `${s} stage ${i} order=${stage.order}`),
    );
  }
});

check("flip nextStage walks the 2 acquisition stages and ends", () => {
  let key: string | null = "potential";
  let count = 0;
  while (key) {
    count++;
    const n = nextStage("flip", key);
    key = n?.key ?? null;
  }
  assert(count === 2, `walked ${count} flip stages`);
});

check("market-entry: wholesale keeps it; flip/rental moved market work to the Project", () => {
  // Wholesale still overlaps the single transaction, so its disposition stage
  // is the market entry. Flip/rental's market work (prep-to-list / lease-up)
  // now lives in the Project + disposition transaction, so the flat template
  // has no market-entry stage. (Gmail activation for those follows the
  // disposition transaction — flagged as a follow-up.)
  assert(marketEntryStage("wholesale")?.key === "disposition", "wholesale → disposition");
  assert(marketEntryStage("flip") === null, "flip → none (moved to Project)");
  assert(marketEntryStage("rental_brrrr") === null, "rental → none (moved to Project)");
  assert(marketEntryStage("retail") === null, "retail → none");
});

check("wholesale reaches market at disposition (overlap strategy)", () => {
  assert(!hasReachedMarketEntry("wholesale", "under_contract"), "wholesale UC not reached");
  assert(hasReachedMarketEntry("wholesale", "disposition"), "wholesale disposition reached");
});

console.log(`\n${passed} passed.`);
