/**
 * Minimal round-trip test for EncryptionService.
 * Run with:  pnpm crypto:test
 *
 * Not a framework test — just a deterministic script that throws on failure.
 */

import { EncryptionService, EncryptionError } from "./encryption";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

// 32 bytes / 64 hex chars — deterministic key for the test
const TEST_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const svc = new EncryptionService(TEST_KEY);

// 1. round-trip
{
  const plain = "hello, real-estate-os";
  const env = svc.encrypt(plain);
  assert(env.split(".").length === 4, "envelope has 4 segments");
  const decoded = svc.decrypt(env);
  assert(decoded === plain, `round-trip: expected ${plain}, got ${decoded}`);
}

// 2. two encryptions of the same plaintext produce different envelopes
{
  const a = svc.encrypt("same");
  const b = svc.encrypt("same");
  assert(a !== b, "IV/salt randomness: two encrypts must differ");
}

// 3. tamper detection
{
  const env = svc.encrypt("sensitive");
  const parts = env.split(".");
  // flip one bit in the ciphertext
  const ct = Buffer.from(parts[3], "base64");
  ct[0] ^= 0x01;
  parts[3] = ct.toString("base64");
  const tampered = parts.join(".");
  let threw = false;
  try {
    svc.decrypt(tampered);
  } catch (err) {
    threw = err instanceof EncryptionError;
  }
  assert(threw, "tampered ciphertext must throw EncryptionError");
}

// 4. wrong key fails
{
  const env = svc.encrypt("other");
  const wrong = new EncryptionService(
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  );
  let threw = false;
  try {
    wrong.decrypt(env);
  } catch {
    threw = true;
  }
  assert(threw, "wrong key must fail decrypt");
}

// 5. large payload
{
  const big = "x".repeat(100_000);
  const env = svc.encrypt(big);
  assert(svc.decrypt(env) === big, "large payload round-trip");
}

// 6. bad envelope formats
{
  for (const bad of ["", "notanenvelope", "a.b.c"]) {
    let threw = false;
    try {
      svc.decrypt(bad);
    } catch {
      threw = true;
    }
    assert(threw, `malformed envelope rejected: ${JSON.stringify(bad)}`);
  }
}

console.log("encryption.test.ts: all checks passed ✓");
