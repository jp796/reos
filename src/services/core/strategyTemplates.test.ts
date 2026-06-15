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

check("flip has 7 stages, rental & creative have 6", () => {
  assert(getStrategyTemplate("flip").length === 7, "flip 7");
  assert(getStrategyTemplate("rental_brrrr").length === 6, "rental 6");
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

check("flip nextStage walks all 7 and ends", () => {
  let key: string | null = "potential";
  let count = 0;
  while (key) {
    count++;
    const n = nextStage("flip", key);
    key = n?.key ?? null;
  }
  assert(count === 7, `walked ${count} flip stages`);
});

check("market-entry stage is correct per strategy", () => {
  assert(marketEntryStage("flip")?.key === "prep_to_list", "flip → prep_to_list");
  assert(marketEntryStage("wholesale")?.key === "disposition", "wholesale → disposition");
  assert(marketEntryStage("rental_brrrr")?.key === "lease_up", "rental → lease_up");
  assert(marketEntryStage("retail") === null, "retail → none");
});

check("Gmail stays off pre-market, on at/after market entry (flip)", () => {
  // Before market: acquisition + rehab stages → not reached.
  assert(!hasReachedMarketEntry("flip", "under_contract_purchase"), "under contract not reached");
  assert(!hasReachedMarketEntry("flip", "rehab"), "rehab not reached");
  // At market entry and beyond → reached.
  assert(hasReachedMarketEntry("flip", "prep_to_list"), "prep_to_list reached");
  assert(hasReachedMarketEntry("flip", "on_market"), "on_market reached");
  assert(hasReachedMarketEntry("flip", "sold"), "sold reached");
  // No stage yet → not reached.
  assert(!hasReachedMarketEntry("flip", null), "null not reached");
});

check("wholesale reaches market at disposition; BRRRR at lease_up", () => {
  assert(!hasReachedMarketEntry("wholesale", "under_contract"), "wholesale UC not reached");
  assert(hasReachedMarketEntry("wholesale", "disposition"), "wholesale disposition reached");
  assert(!hasReachedMarketEntry("rental_brrrr", "renovations"), "BRRRR reno not reached");
  assert(hasReachedMarketEntry("rental_brrrr", "lease_up"), "BRRRR lease_up reached");
});

console.log(`\n${passed} passed.`);
