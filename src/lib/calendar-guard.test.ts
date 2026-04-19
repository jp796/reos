/**
 * Smoke test for calendar-guard.
 * Run: npx tsx src/lib/calendar-guard.test.ts
 */

import { google } from "googleapis";
import { makeSafeCalendar, CalendarGuardError, _BLOCKED_PATHS } from "./calendar-guard";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const fakeAuth = new google.auth.OAuth2(
  "fake-id",
  "fake-secret",
  "http://localhost:3000/cb",
);
const c = makeSafeCalendar(fakeAuth);

// 1. Blocked-paths list covers expected methods
for (const path of [
  "events.delete",
  "events.move",
  "calendars.delete",
  "calendars.clear",
  "acl.delete",
  "acl.insert",
]) {
  assert(
    _BLOCKED_PATHS.includes(path),
    `blocked paths must include ${path}; got ${_BLOCKED_PATHS.join(",")}`,
  );
}

// 2. events.delete throws
{
  let threw = false;
  try {
    c.events.delete({ calendarId: "primary", eventId: "x" });
  } catch (err) {
    threw = err instanceof CalendarGuardError;
  }
  assert(threw, "events.delete must throw CalendarGuardError");
}

// 3. calendars.clear throws
{
  let threw = false;
  try {
    c.calendars.clear({ calendarId: "primary" });
  } catch (err) {
    threw = err instanceof CalendarGuardError;
  }
  assert(threw, "calendars.clear must throw CalendarGuardError");
}

// 4. events.move throws
{
  let threw = false;
  try {
    c.events.move({ calendarId: "primary", eventId: "x", destination: "y" });
  } catch (err) {
    threw = err instanceof CalendarGuardError;
  }
  assert(threw, "events.move must throw CalendarGuardError");
}

// 5. acl.insert throws
{
  let threw = false;
  try {
    c.acl.insert({ calendarId: "primary", requestBody: {} });
  } catch (err) {
    threw = err instanceof CalendarGuardError;
  }
  assert(threw, "acl.insert must throw CalendarGuardError");
}

// 6. Safe methods remain callable functions (not throwing stubs)
assert(typeof c.events.list === "function", "events.list stays callable");
assert(typeof c.events.get === "function", "events.get stays callable");
assert(typeof c.events.insert === "function", "events.insert stays callable");
assert(typeof c.events.patch === "function", "events.patch stays callable");
assert(typeof c.events.update === "function", "events.update stays callable");
assert(
  typeof c.calendarList.list === "function",
  "calendarList.list stays callable",
);

console.log("calendar-guard.test: all checks passed ✓");
