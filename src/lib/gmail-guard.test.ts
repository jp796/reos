/**
 * Unit test for gmail-guard. Proves the Proxy blocks every destructive
 * method in the chain and lets safe methods through.
 *
 * Run: npx tsx src/lib/gmail-guard.test.ts
 */

import { _BLOCKED_PATHS, GmailGuardError } from "./gmail-guard";

// We don't need a real OAuth client — exercise the guard on a stand-in
// that mirrors the nested Gmail API surface.
import { google } from "googleapis";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

// Re-import guard-producing helper by constructing a fake client.
// makeSafeGmail requires an OAuth2Client, but we can reach the guard via
// a minimal mock directly.
import { makeSafeGmail } from "./gmail-guard";

// Minimal OAuth2Client stub — googleapis doesn't actually hit the network
// until a call is made.
const fakeAuth = new google.auth.OAuth2(
  "fake-client-id",
  "fake-client-secret",
  "http://localhost:3000/cb",
);

const g = makeSafeGmail(fakeAuth);

// 1. Seed list has the expected paths
assert(
  _BLOCKED_PATHS.includes("users.messages.delete"),
  "messages.delete path must be listed",
);
assert(
  _BLOCKED_PATHS.includes("users.messages.trash"),
  "messages.trash path must be listed",
);
assert(
  _BLOCKED_PATHS.includes("users.messages.send"),
  "messages.send path must be listed",
);
assert(
  _BLOCKED_PATHS.includes("users.messages.batchDelete"),
  "messages.batchDelete path must be listed",
);
assert(
  _BLOCKED_PATHS.includes("users.threads.trash"),
  "threads.trash path must be listed",
);

// 2. Destructive methods on messages throw before hitting the network
{
  let threw = false;
  try {
    g.users.messages.trash({ userId: "me", id: "x" });
  } catch (err) {
    threw = err instanceof GmailGuardError;
  }
  assert(threw, "messages.trash must throw GmailGuardError");
}

{
  let threw = false;
  try {
    g.users.messages.delete({ userId: "me", id: "x" });
  } catch (err) {
    threw = err instanceof GmailGuardError;
  }
  assert(threw, "messages.delete must throw GmailGuardError");
}

{
  let threw = false;
  try {
    g.users.messages.send({ userId: "me", requestBody: { raw: "hi" } });
  } catch (err) {
    threw = err instanceof GmailGuardError;
  }
  assert(threw, "messages.send must throw GmailGuardError");
}

// 3. batchDelete / batchModify are blocked even though they appear only
//    at deeper paths
{
  let threw = false;
  try {
    g.users.messages.batchDelete({ userId: "me", requestBody: { ids: ["x"] } });
  } catch (err) {
    threw = err instanceof GmailGuardError;
  }
  assert(threw, "messages.batchDelete must throw GmailGuardError");
}

// 4. threads.delete blocked
{
  let threw = false;
  try {
    g.users.threads.delete({ userId: "me", id: "x" });
  } catch (err) {
    threw = err instanceof GmailGuardError;
  }
  assert(threw, "threads.delete must throw GmailGuardError");
}

// 5. threads.trash blocked
{
  let threw = false;
  try {
    g.users.threads.trash({ userId: "me", id: "x" });
  } catch (err) {
    threw = err instanceof GmailGuardError;
  }
  assert(threw, "threads.trash must throw GmailGuardError");
}

// 6. drafts.send blocked
{
  let threw = false;
  try {
    g.users.drafts.send({ userId: "me", requestBody: {} });
  } catch (err) {
    threw = err instanceof GmailGuardError;
  }
  assert(threw, "drafts.send must throw GmailGuardError");
}

// 7. labels.delete blocked (we don't currently remove labels, but guard it)
{
  let threw = false;
  try {
    g.users.labels.delete({ userId: "me", id: "x" });
  } catch (err) {
    threw = err instanceof GmailGuardError;
  }
  assert(threw, "labels.delete must throw GmailGuardError");
}

async function main() {
  // 8. SAFE methods should NOT be transformed into throwing stubs — they
  //    remain real functions that attempt a network call (which will fail
  //    with an auth/network error against fake creds, but that proves we
  //    got past the guard).
  const fn = g.users.threads.list;
  assert(typeof fn === "function", "threads.list should still be a function");

  let threwGuardError = false;
  try {
    await g.users.threads.list({ userId: "me" });
  } catch (err) {
    threwGuardError = err instanceof GmailGuardError;
  }
  assert(!threwGuardError, "threads.list must NOT throw GmailGuardError");

  // 9. labels.list + labels.create are allowed
  assert(
    typeof g.users.labels.list === "function",
    "labels.list remains a function",
  );
  assert(
    typeof g.users.labels.create === "function",
    "labels.create remains a function",
  );

  // 10. threads.modify remains a function (how we apply labels)
  assert(
    typeof g.users.threads.modify === "function",
    "threads.modify remains a function (needed to apply labels)",
  );

  console.log("gmail-guard.test: all checks passed ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
