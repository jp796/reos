/**
 * Smoke test for subject-parser.
 * Run: npx tsx src/lib/subject-parser.test.ts
 */

import { parseSubjectParties, nameVariants } from "./subject-parser";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

// --- parseSubjectParties ---

// 1. Full firstam.com commission subject
{
  const r = parseSubjectParties(
    "Commission Confirmation for File Number-4360385-Address-4808 Rock Springs Street-Buyer-Judy Gebhard-Seller-Derek J. and Korin A. Schmidt Joint Revocable Trust (Email Ref=2600709827)",
  );
  assert(r.buyer === "Judy Gebhard", `buyer: ${r.buyer}`);
  assert(
    r.seller === "Derek J. and Korin A. Schmidt Joint Revocable Trust",
    `seller: ${r.seller}`,
  );
  assert(r.fileNumber === "4360385", `file: ${r.fileNumber}`);
}

// 2. File-number-only subject (no buyer/seller)
{
  const r = parseSubjectParties(
    "File Number-4371522-Address-273 Road 210 and (Email Ref=2600647433)",
  );
  assert(r.fileNumber === "4371522", `file: ${r.fileNumber}`);
  assert(!r.buyer, "no buyer expected");
  assert(!r.seller, "no seller expected");
}

// 3. Address-only subject
{
  const r = parseSubjectParties("4808 Rock Springs Street, Cheyenne, WY 82001");
  assert(!r.buyer && !r.seller && !r.fileNumber, "nothing to parse");
}

// 4. "File #" variant
{
  const r = parseSubjectParties("Order status — File #-24-0987");
  assert(r.fileNumber === "24-0987", `file: ${r.fileNumber}`);
}

// --- nameVariants ---

// 5. Simple name — produces base + first/last no-initial variant
{
  const v = nameVariants("Judy Gebhard");
  assert(v.includes("Judy Gebhard"), "preserves original");
}

// 6. Name with initial — strip initial
{
  const v = nameVariants("Derek J. Schmidt");
  assert(
    v.some((s) => s === "Derek Schmidt"),
    `should produce "Derek Schmidt"; got ${JSON.stringify(v)}`,
  );
}

// 7. Joint trust name — splits on "and", produces individual-plus-lastname
{
  const v = nameVariants(
    "Derek J. and Korin A. Schmidt Joint Revocable Trust",
  );
  assert(
    v.some((s) => s.toLowerCase() === "derek schmidt"),
    `expected "Derek Schmidt"; got ${JSON.stringify(v)}`,
  );
  assert(
    v.some((s) => s.toLowerCase() === "korin schmidt"),
    `expected "Korin Schmidt"; got ${JSON.stringify(v)}`,
  );
}

// 8. LLC stripped
{
  const v = nameVariants("Acme Holdings LLC");
  assert(
    v.some((s) => s === "Acme Holdings"),
    `expected "Acme Holdings"; got ${JSON.stringify(v)}`,
  );
}

// 9. Empty / too-short names are filtered
{
  const v = nameVariants("A");
  assert(v.length === 0, `too-short should be empty; got ${JSON.stringify(v)}`);
}

console.log("subject-parser.test: all checks passed ✓");
