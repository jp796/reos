/**
 * Smoke test for TitleCompanyDetector + address-parser.
 * Run with:  npx tsx src/services/ai/TitleCompanyDetector.test.ts
 */

import {
  detectTitleCompanyEmail,
  KNOWN_TITLE_DOMAINS,
} from "./TitleCompanyDetector";
import { extractAddresses, normalizeAddress } from "@/lib/address-parser";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

// ==================================================
// Detector cases
// ==================================================

// 1. Known domain → high confidence
{
  const r = detectTitleCompanyEmail({
    fromEmail: "jane@firstam.com",
    fromName: "Jane Smith",
    subject: "Title commitment for 4567 Oak Dr, Nixa MO",
    bodyText: "Please review the title commitment and wire earnest money.",
    attachmentFilenames: ["TitleCommitment_4567OakDr.pdf"],
  });
  assert(r.isTitleCompany, "firstam.com should be detected");
  assert(r.confidence >= 0.9, `expected >=0.9, got ${r.confidence}`);
  assert(r.matchedDomain === "firstam.com", "should match firstam.com");
}

// 2. Hogan (ccsend subdomain) → known domain match
{
  const r = detectTitleCompanyEmail({
    fromEmail: "closer@hogantitle.ccsend.com",
    fromName: "Sarah — Closing Officer",
    subject: "File # 24-0987 — 1420 E 19TH ST CHEYENNE",
    bodyText: "Order number included. Please review the closing disclosure.",
  });
  assert(r.isTitleCompany, "hogantitle.ccsend.com should match");
  assert(r.matchedDomain === "hogantitle.ccsend.com");
}

// 3. Unknown domain with strong body signals → still detects via fallback
{
  const r = detectTitleCompanyEmail({
    fromEmail: "office@nationaltitleco.com",
    fromName: "Escrow Officer",
    subject: "Title order and wiring instructions",
    bodyText: "Commitment for title insurance attached. File number 9999.",
    attachmentFilenames: ["title_commitment.pdf"],
  });
  assert(r.isTitleCompany, `fallback signals should trigger; got ${r.confidence}`);
}

// 4. Non-title email → no match
{
  const r = detectTitleCompanyEmail({
    fromEmail: "hi@zillow.com",
    fromName: "Zillow",
    subject: "New lead: Interested buyer for 123 Main St",
    bodyText: "A buyer is interested in your listing.",
  });
  assert(!r.isTitleCompany, "random marketing email should not match");
  assert(r.confidence < 0.7, `too high confidence: ${r.confidence}`);
}

// 5. All known domains configured
assert(KNOWN_TITLE_DOMAINS.length >= 5, "expected at least 5 seed domains");
for (const d of ["fste.com", "firstam.com", "mtc.llc", "tsqtitle.com", "hogantitle.ccsend.com"]) {
  assert(KNOWN_TITLE_DOMAINS.includes(d), `missing seed domain: ${d}`);
}

// ==================================================
// Address parser cases
// ==================================================

// 6. Subject-line address extraction
{
  const a = extractAddresses(
    "Title order for 4567 Oak Dr, Nixa MO 65714 — please review",
  );
  assert(a.length >= 1, "should extract 1 address");
  assert(a[0].street.toLowerCase().includes("oak"), "street should include oak");
  assert(a[0].state === "MO", `state should be MO, got ${a[0].state}`);
  assert(a[0].zip === "65714", `zip should be 65714`);
}

// 7. Multiple addresses in a block of text
{
  const a = extractAddresses(
    "We have listings at 123 Main St, Springfield MO and 4567 Oak Dr, Nixa MO.",
  );
  assert(a.length >= 2, `expected 2, got ${a.length}`);
}

// 8. Normalize is stable across case and punctuation
{
  const k1 = normalizeAddress({ street: "123 Main St", city: "Nixa", state: "mo", zip: "65714" });
  const k2 = normalizeAddress({ street: "123 main st.", city: "NIXA", state: "MO", zip: "65714" });
  assert(k1 === k2, `normalization not stable: ${k1} vs ${k2}`);
}

// 9. Plain city-only reference doesn't produce a phantom address
{
  const a = extractAddresses("Just a quick note about Nixa MO market trends.");
  assert(a.length === 0, `expected 0 addresses, got ${a.length}`);
}

console.log("TitleCompanyDetector.test: all checks passed ✓");
