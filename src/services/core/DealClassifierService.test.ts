/**
 * Tests for DealClassifierService (spec §5 auto-detect).
 * Run with:  bun tsx src/services/core/DealClassifierService.test.ts
 *        or: npx tsx src/services/core/DealClassifierService.test.ts
 */

import { classifyDeal } from "./DealClassifierService";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("DealClassifierService — §5 auto-detect");

check("retail is the safe default with no signals", () => {
  const r = classifyDeal({});
  assert(r.strategy === "retail", `strategy=${r.strategy}`);
  assert(r.representation === "agency", `rep=${r.representation}`);
  assert(r.confidence <= 0.5, "bare default should be low-confidence");
});

check("client party + commission → retail/agency, higher confidence", () => {
  const r = classifyDeal({
    hasClientParty: true,
    hasCommissionExpectation: true,
  });
  assert(r.strategy === "retail", `strategy=${r.strategy}`);
  assert(r.representation === "agency", `rep=${r.representation}`);
  assert(r.confidence >= 0.6, "agency evidence should raise confidence");
});

check("rehab + resale, no rent/refi → flip / takes_title", () => {
  const r = classifyDeal({ hasRehabBudget: true, hasResaleIntent: true });
  assert(r.strategy === "flip", `strategy=${r.strategy}`);
  assert(r.representation === "principal", `rep=${r.representation}`);
  assert(r.titlePath === "takes_title", `titlePath=${r.titlePath}`);
});

check("assignment clause + no rehab → wholesale / assignment", () => {
  const r = classifyDeal({
    hasAssignmentClause: true,
    hasCashBuyerDisposition: true,
  });
  assert(r.strategy === "wholesale", `strategy=${r.strategy}`);
  assert(r.titlePath === "assignment", `titlePath=${r.titlePath}`);
});

check("two-closing intent, no assignment, no rehab → wholesale / double_close", () => {
  const r = classifyDeal({ twoClosingIntent: true });
  assert(r.strategy === "wholesale", `strategy=${r.strategy}`);
  assert(r.titlePath === "double_close", `titlePath=${r.titlePath}`);
});

check("rehab + rent + refi → rental_brrrr / takes_title", () => {
  const r = classifyDeal({
    hasRehabBudget: true,
    hasRentEstimate: true,
    hasRefinanceIntent: true,
  });
  assert(r.strategy === "rental_brrrr", `strategy=${r.strategy}`);
  assert(r.titlePath === "takes_title", `titlePath=${r.titlePath}`);
});

check("BRRRR beats flip when rent/refi present alongside rehab", () => {
  const r = classifyDeal({
    hasRehabBudget: true,
    hasRefinanceIntent: true,
  });
  assert(r.strategy === "rental_brrrr", `strategy=${r.strategy}`);
});

check("subject-to phrasing → creative / subject_to / takes_title", () => {
  const r = classifyDeal({
    text: "Buyer takes title subject to the existing mortgage of record.",
  });
  assert(r.strategy === "creative", `strategy=${r.strategy}`);
  assert(r.creativeSubstructure === "subject_to", `sub=${r.creativeSubstructure}`);
  assert(r.titlePath === "takes_title", `titlePath=${r.titlePath}`);
});

check("seller financing phrasing → creative / seller_finance", () => {
  const r = classifyDeal({ text: "Seller agrees to owner carry / seller financing with a balloon in 5 years." });
  assert(r.strategy === "creative", `strategy=${r.strategy}`);
  assert(r.creativeSubstructure === "seller_finance", `sub=${r.creativeSubstructure}`);
  assert(r.reasons.some((x) => /balloon/i.test(x)), "should note balloon term");
});

check("lease-option phrasing → creative / lease_option / contract_rights", () => {
  const r = classifyDeal({ text: "This is a lease option agreement with an option to purchase." });
  assert(r.strategy === "creative", `strategy=${r.strategy}`);
  assert(r.creativeSubstructure === "lease_option", `sub=${r.creativeSubstructure}`);
  assert(r.titlePath === "contract_rights", `titlePath=${r.titlePath}`);
});

check("wrap phrasing → creative / wrap", () => {
  const r = classifyDeal({ text: "Financing via an all-inclusive trust deed (AITD wrap)." });
  assert(r.strategy === "creative", `strategy=${r.strategy}`);
  assert(r.creativeSubstructure === "wrap", `sub=${r.creativeSubstructure}`);
});

check("creative wins over rehab signals when instrument present", () => {
  const r = classifyDeal({
    text: "Purchase subject to existing financing.",
    hasRehabBudget: true,
    hasResaleIntent: true,
  });
  assert(r.strategy === "creative", `strategy=${r.strategy}`);
});

console.log(`\n${passed} passed.`);
