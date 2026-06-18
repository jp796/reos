/**
 * Tests for AtlasTools registry + the "no mistakes" contract (tiers,
 * confirmation gating, schema validation). Executors that need a DB are
 * covered by integration paths; here we lock the safety invariants.
 * Run with: bun tsx src/services/ai/AtlasTools.test.ts
 */

import {
  ATLAS_TOOLS,
  toolNames,
  toolTier,
  requiresConfirmation,
  openAiToolSpecs,
} from "./AtlasTools";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("AtlasTools — agent action contract");

check("every tool has tier, description, schema, run", () => {
  for (const [name, def] of Object.entries(ATLAS_TOOLS)) {
    assert(["read", "write", "sensitive"].includes(def.tier), `${name} tier`);
    assert(def.description.length > 0, `${name} description`);
    assert(typeof def.run === "function", `${name} run`);
    assert(def.schema, `${name} schema`);
  }
});

check("only read tools auto-run; writes require confirmation", () => {
  assert(toolTier("find_deal") === "read", "find_deal is read");
  assert(!requiresConfirmation("find_deal"), "find_deal auto-runs");
  for (const w of ["add_task", "complete_task", "set_deadline", "advance_stage", "set_stage", "add_note"]) {
    assert(requiresConfirmation(w), `${w} requires confirmation`);
  }
});

check("unknown tools deny-by-default (treated sensitive + confirm)", () => {
  assert(toolTier("delete_everything") === "sensitive", "unknown → sensitive");
  assert(requiresConfirmation("delete_everything"), "unknown → confirm");
});

check("schemas reject malformed args (no free-text leakage)", () => {
  // add_task requires a title
  const bad = ATLAS_TOOLS.add_task.schema.safeParse({ deal: "509 Bent" });
  assert(!bad.success, "add_task without title rejected");
  const good = ATLAS_TOOLS.add_task.schema.safeParse({ deal: "509 Bent", title: "Call lender" });
  assert(good.success, "valid add_task accepted");
});

check("set_deadline only accepts known deadline kinds", () => {
  const bad = ATLAS_TOOLS.set_deadline.schema.safeParse({ deal: "x", kind: "birthday", date: "2026-01-01" });
  assert(!bad.success, "unknown deadline kind rejected");
  const good = ATLAS_TOOLS.set_deadline.schema.safeParse({ deal: "x", kind: "closing", date: "2026-01-01" });
  assert(good.success, "closing kind accepted");
});

check("openAiToolSpecs lists every tool as a function", () => {
  const specs = openAiToolSpecs();
  assert(specs.length === toolNames().length, "spec count matches tools");
  assert(specs.every((s) => s.type === "function" && s.function.name), "all are functions");
});

console.log(`\n${passed} passed.`);
