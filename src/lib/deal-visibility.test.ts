/**
 * Tests for deal-visibility (per-deal privacy).
 * Run with: bun tsx src/lib/deal-visibility.test.ts
 */

import {
  canSeeAllDeals,
  canToggleRestriction,
  dealVisibilityWhere,
  isDealVisible,
} from "./deal-visibility";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("deal-visibility");

const owner = { userId: "u_owner", role: "owner" };
const admin = { userId: "u_admin", role: "admin" };
const tcA = { userId: "u_tcA", role: "coordinator" };
const tcB = { userId: "u_tcB", role: "tc" };

check("owners + admins can see all deals; coordinators cannot", () => {
  assert(canSeeAllDeals("owner"), "owner");
  assert(canSeeAllDeals("ADMIN"), "admin (case-insensitive)");
  assert(!canSeeAllDeals("coordinator"), "coordinator");
  assert(!canSeeAllDeals("tc"), "tc");
  assert(!canSeeAllDeals(null), "null");
});

check("only owners/admins may toggle restriction", () => {
  assert(canToggleRestriction("owner"), "owner toggles");
  assert(!canToggleRestriction("coordinator"), "coordinator cannot toggle");
});

check("dealVisibilityWhere: privileged → no filter", () => {
  assert(Object.keys(dealVisibilityWhere(owner)).length === 0, "owner empty");
  assert(Object.keys(dealVisibilityWhere(admin)).length === 0, "admin empty");
});

check("dealVisibilityWhere: coordinator → non-restricted OR own", () => {
  const w = dealVisibilityWhere(tcA) as { OR: Array<Record<string, unknown>> };
  assert(Array.isArray(w.OR) && w.OR.length === 2, "has OR of 2");
  assert(w.OR[0].restrictedToAssignee === false, "branch 1: non-restricted");
  assert(w.OR[1].assignedUserId === "u_tcA", "branch 2: own deals");
});

const openDeal = { restrictedToAssignee: false, assignedUserId: "u_tcA" };
const restrictedToA = { restrictedToAssignee: true, assignedUserId: "u_tcA" };

check("non-restricted deal: everyone can view", () => {
  assert(isDealVisible(tcB, openDeal), "other TC sees open deal");
  assert(isDealVisible(owner, openDeal), "owner sees open deal");
});

check("restricted deal: assignee + owner + admin only", () => {
  assert(isDealVisible(tcA, restrictedToA), "assignee sees it");
  assert(isDealVisible(owner, restrictedToA), "owner sees it");
  assert(isDealVisible(admin, restrictedToA), "admin sees it");
  assert(!isDealVisible(tcB, restrictedToA), "other TC BLOCKED");
});

console.log(`\n${passed} passed.`);
