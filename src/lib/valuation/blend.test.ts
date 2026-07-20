/**
 * Tests for the REOS blended valuation engine.
 *
 * Self-contained — no test framework dependency. Runs directly under either
 *   bunx tsx src/lib/valuation/blend.test.ts
 *   bun     src/lib/valuation/blend.test.ts
 * Exits 0 when all pass, 1 (with a diff) on the first failure.
 *
 * NOTE: this file was authored during integration — the original six-file drop
 * listed blend.test.ts but only shipped a byte-duplicate of blend.ts, so the
 * suite here was written fresh against the engine's documented contract.
 */
import assert from "node:assert/strict";
import {
  blend,
  buildSources,
  renderCard,
  DEFAULT_WEIGHTS,
  OUTLIER_THRESHOLD,
} from "./blend";

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  }
}
const approx = (a: number, b: number, eps = 1e-6) =>
  Math.abs(a - b) <= eps ? true : assert.fail(`${a} !~= ${b}`);

// --- buildSources ---------------------------------------------------------- //
test("buildSources skips nulls and keeps canonical order", () => {
  const s = buildSources({ manual: 250_000, engine: 300_000 });
  assert.equal(s.length, 2);
  assert.equal(s[0].source, "engine"); // engine sorts before manual
  assert.equal(s[1].source, "manual");
});

test("buildSources tags portals/manual as manual, model as auto", () => {
  const s = buildSources({ engine: 300_000, rpr_rvm: 305_000, zillow: 290_000, manual: 310_000 });
  const by = Object.fromEntries(s.map((x) => [x.source, x.enteredBy]));
  assert.equal(by.engine, "auto");
  assert.equal(by.rpr_rvm, "auto");
  assert.equal(by.zillow, "manual");
  assert.equal(by.manual, "manual");
});

test("buildSources rejects non-positive values", () => {
  assert.throws(() => buildSources({ engine: 0 }), /positive number/);
  assert.throws(() => buildSources({ engine: -1 }), /positive number/);
});

// --- blend: core weighted average ------------------------------------------ //
test("blend renormalizes weights over present sources", () => {
  const r = blend(buildSources({ engine: 300_000, rpr_rvm: 310_000 }));
  // raw 0.45 / 0.35 -> 0.5625 / 0.4375; 300k*0.5625 + 310k*0.4375 = 304,375
  approx(r.blendedValue, 304_375);
  approx(r.sources.find((s) => s.source === "engine")!.weight, 0.5625);
  approx(r.sources.find((s) => s.source === "rpr_rvm")!.weight, 0.4375);
  assert.equal(r.sourceCount, 2);
});

test("blend of a single source returns it verbatim, low confidence", () => {
  const r = blend(buildSources({ engine: 250_000 }));
  approx(r.blendedValue, 250_000);
  assert.equal(r.valueLow, 250_000);
  assert.equal(r.valueHigh, 250_000);
  approx(r.spreadPct, 0);
  assert.equal(r.confidence, "low"); // a lone opinion is never high
  assert.equal(r.sourceCount, 1);
});

// --- blend: outliers ------------------------------------------------------- //
test("blend flags and drops an outlier by default", () => {
  const r = blend(buildSources({ engine: 300_000, rpr_rvm: 305_000, zillow: 600_000 }));
  const z = r.sources.find((s) => s.source === "zillow")!;
  assert.equal(z.isOutlier, true);
  assert.equal(z.included, false);
  assert.equal(r.sourceCount, 2); // zillow excluded from the blend
  // blended must not be dragged toward 600k
  assert.ok(r.blendedValue < 320_000, `blended ${r.blendedValue} should exclude the outlier`);
});

test("blend keeps outliers when dropOutliers=false", () => {
  const r = blend(buildSources({ engine: 300_000, rpr_rvm: 305_000, zillow: 600_000 }), {
    dropOutliers: false,
  });
  assert.equal(r.sourceCount, 3);
  assert.equal(r.sources.find((s) => s.source === "zillow")!.included, true);
});

test("blend falls back to all-sources when everything is flagged", () => {
  const r = blend(buildSources({ engine: 100_000, manual: 1_000_000 }));
  assert.equal(r.sourceCount, 2); // neither can be dropped
  assert.ok(r.sources.every((s) => s.included));
  assert.equal(r.confidence, "low"); // massive disagreement
});

// --- blend: confidence tiers ----------------------------------------------- //
test("tight cluster of >=3 sources is high confidence", () => {
  const r = blend(buildSources({ engine: 300_000, rpr_rvm: 303_000, manual: 298_000 }));
  assert.equal(r.sourceCount, 3);
  assert.ok(r.spreadPct <= 0.07);
  assert.equal(r.confidence, "high");
});

test("moderate spread is medium confidence", () => {
  const r = blend(buildSources({ engine: 300_000, rpr_rvm: 330_000 }));
  assert.ok(r.spreadPct > 0.07 && r.spreadPct <= 0.15);
  assert.equal(r.confidence, "medium");
});

// --- blend: guards + envelope ---------------------------------------------- //
test("blend throws on empty source list", () => {
  assert.throws(() => blend([]), /at least one source/);
});

test("envelope reports the included min/max and target condition passes through", () => {
  const r = blend(buildSources({ engine: 300_000, rpr_rvm: 320_000 }), {
    targetCondition: "C3",
  });
  assert.equal(r.valueLow, 300_000);
  assert.equal(r.valueHigh, 320_000);
  assert.equal(r.targetCondition, "C3");
});

// --- constants + rendering ------------------------------------------------- //
test("weights + threshold constants are sane", () => {
  assert.ok(DEFAULT_WEIGHTS.engine > DEFAULT_WEIGHTS.rpr_rvm);
  assert.ok(DEFAULT_WEIGHTS.rpr_rvm > DEFAULT_WEIGHTS.zillow);
  assert.equal(OUTLIER_THRESHOLD, 0.25);
});

test("renderCard produces a readable card with the blended value", () => {
  const r = blend(buildSources({ engine: 300_000, rpr_rvm: 310_000 }), { targetCondition: "C3" });
  const card = renderCard(r, "123 Main St");
  assert.match(card, /123 Main St/);
  assert.match(card, /BLENDED VALUE/);
  assert.match(card, /Confidence MEDIUM/);
  assert.match(card, /C3/);
});

console.log(`\n${passed} passed`);
