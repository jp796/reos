/**
 * Tests for DrawEngine pure logic (spec §7).
 * Run with: bun tsx src/services/core/DrawEngine.test.ts
 */

import { computeRelease, canRelease } from "./DrawEngine";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("DrawEngine — §7 lien-waiver gate + retainage");

check("retainage withheld at 10%", () => {
  const r = computeRelease(20000, 10);
  assert(r.retainageHeld === 2000, `held=${r.retainageHeld}`);
  assert(r.net === 18000, `net=${r.net}`);
});

check("0% retainage releases full amount", () => {
  const r = computeRelease(15000, 0);
  assert(r.retainageHeld === 0 && r.net === 15000, "full release");
});

check("retainage clamps to [0,100]", () => {
  assert(computeRelease(1000, 150).retainageHeld === 1000, "clamps to 100");
  assert(computeRelease(1000, -5).retainageHeld === 0, "clamps to 0");
});

check("gate blocks release without lien waiver", () => {
  const g = canRelease({
    status: "verified",
    verifiedAt: new Date(),
    lienWaiverDocId: null,
  });
  assert(!g.ok && g.reason === "lien_waiver_required", `reason=${g.reason}`);
});

check("gate blocks release before verification", () => {
  const g = canRelease({
    status: "requested",
    verifiedAt: null,
    lienWaiverDocId: "doc_1",
  });
  assert(!g.ok && g.reason === "not_verified", `reason=${g.reason}`);
});

check("gate passes when verified + lien waiver present", () => {
  const g = canRelease({
    status: "verified",
    verifiedAt: new Date(),
    lienWaiverDocId: "doc_1",
  });
  assert(g.ok, "should pass");
});

check("gate blocks double-release", () => {
  const g = canRelease({
    status: "released",
    verifiedAt: new Date(),
    lienWaiverDocId: "doc_1",
  });
  assert(!g.ok && g.reason === "already_released", `reason=${g.reason}`);
});

console.log(`\n${passed} passed.`);
