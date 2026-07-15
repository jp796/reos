/**
 * Deterministic regression test for Atlas Trace §4 — addendum reconciliation.
 *
 * Exercises mergeExtractionsByRecency's conflict detection with synthetic
 * extractions (no OpenAI call). A base contract + an addendum that changes
 * some material terms should yield exactly those changes as conflicts, and
 * a term the addendum doesn't restate must be preserved, not reported.
 *
 *   bun run scripts/test-conflict-merge.ts
 */

import {
  mergeExtractionsByRecency,
  type ContractExtraction,
  type FieldConflict,
} from "@/services/ai/ContractExtractionService";

const f = (value: unknown, extra: Partial<{ confidence: number; snippet: string; page: number }> = {}) => ({
  value,
  confidence: extra.confidence ?? 0.9,
  snippet: extra.snippet ?? null,
  page: extra.page ?? null,
});

// Minimal shared key set — merge only reads per-field {value,confidence,snippet,page}
// and effectiveDate.value for ordering.
const base = {
  effectiveDate: f("2026-07-01", { page: 1 }),
  closingDate: f("2026-07-30", { page: 4, snippet: "close on or before July 30" }),
  purchasePrice: f(300000, { page: 1 }),
  earnestMoneyAmount: f(5000, { page: 2 }),
  possessionDate: f("2026-07-30", { page: 4 }),
  notes: null,
} as unknown as ContractExtraction;

const addendum = {
  effectiveDate: f("2026-07-10", { page: 1 }),
  closingDate: f("2026-08-15", { page: 1, snippet: "closing extended to August 15" }), // CHANGED
  purchasePrice: f(null), // not restated — must be preserved, not a conflict
  earnestMoneyAmount: f(7500, { page: 1 }), // CHANGED
  possessionDate: f("2026-07-30", { page: 1 }), // restated but SAME — not a conflict
  notes: null,
} as unknown as ContractExtraction;

const conflicts: FieldConflict[] = [];
const merged = mergeExtractionsByRecency([base, addendum], conflicts);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
};

console.log("▶ addendum reconciliation");

// Merge correctness
check("closingDate superseded to addendum value", (merged.closingDate.value as string) === "2026-08-15");
check("earnestMoneyAmount superseded", Number(merged.earnestMoneyAmount.value) === 7500);
check("purchasePrice preserved from base", Number(merged.purchasePrice.value) === 300000, String(merged.purchasePrice.value));

// Conflict detection
const byKey = Object.fromEntries(conflicts.map((c) => [c.key, c]));
check("exactly 2 conflicts reported", conflicts.length === 2, `got ${conflicts.length}: ${conflicts.map((c) => c.key).join(",")}`);
check("closingDate conflict present", !!byKey.closingDate);
check(
  "closingDate original→superseding correct",
  byKey.closingDate?.original.value === "2026-07-30" && byKey.closingDate?.superseding.value === "2026-08-15",
);
check("closingDate carries source pages", byKey.closingDate?.original.page === 4 && byKey.closingDate?.superseding.page === 1);
check("closingDate carries doc effectiveDates", byKey.closingDate?.original.effectiveDate === "2026-07-01" && byKey.closingDate?.superseding.effectiveDate === "2026-07-10");
check("earnestMoney conflict present", !!byKey.earnestMoneyAmount);
check("possessionDate NOT a conflict (restated same value)", !byKey.possessionDate);
check("purchasePrice NOT a conflict (not restated)", !byKey.purchasePrice);

// Single-document + no-sink safety
const solo = mergeExtractionsByRecency([base]);
check("single doc returns unchanged", (solo.closingDate.value as string) === "2026-07-30");
const noSink = mergeExtractionsByRecency([base, addendum]); // no conflicts array — must not throw
check("merge without sink still supersedes", (noSink.closingDate.value as string) === "2026-08-15");

console.log(
  "\n" + "─".repeat(50) + "\n" + (failures === 0 ? "✓ All §4 reconciliation assertions pass." : `✗ ${failures} assertion(s) failed.`),
);
process.exit(failures === 0 ? 0 : 1);
