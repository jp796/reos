import { test, expect, describe } from "bun:test";
import {
  windowFor,
  sentWindows,
  duePhrase,
  buildReminderMessage,
  dayDiff,
} from "./TaskReminderService";

const now = new Date("2026-07-13T12:00:00Z");
const at = (iso: string) => new Date(iso);

describe("reminder windows", () => {
  test("maps day distances to the right window", () => {
    expect(windowFor(at("2026-07-13T09:00:00Z"), now)).toBe("d0"); // today
    expect(windowFor(at("2026-07-14T09:00:00Z"), now)).toBe("d1"); // tomorrow
    expect(windowFor(at("2026-07-16T09:00:00Z"), now)).toBe("d3"); // in 3 days
    expect(windowFor(at("2026-07-10T09:00:00Z"), now)).toBe("overdue");
  });

  test("returns null for days outside a reminder window", () => {
    expect(windowFor(at("2026-07-15T09:00:00Z"), now)).toBeNull(); // 2 days
    expect(windowFor(at("2026-07-18T09:00:00Z"), now)).toBeNull(); // 5 days
    expect(windowFor(null, now)).toBeNull();
  });

  test("dayDiff ignores the time-of-day", () => {
    expect(dayDiff(at("2026-07-13T23:59:00Z"), now)).toBe(0);
    expect(dayDiff(at("2026-07-14T00:01:00Z"), now)).toBe(1);
  });
});

describe("sent-window dedup parsing", () => {
  test("parses a valid array and drops junk", () => {
    expect(sentWindows(["d3", "d0", "nope", 5])).toEqual(["d3", "d0"]);
    expect(sentWindows(null)).toEqual([]);
    expect(sentWindows("d0")).toEqual([]);
  });
});

describe("message building", () => {
  test("lists tasks with due phrasing + overdue count", () => {
    const msg = buildReminderMessage([
      { id: "1", title: "Cancel utilities", window: "overdue", priority: "high", property: "29 Mtn Meadow", transactionId: "tx1", alreadySent: [] },
      { id: "2", title: "Stop the payment", window: "d0", priority: "urgent", property: "404 Main St", transactionId: "tx2", alreadySent: [] },
    ]);
    expect(msg).toContain("2 tasks need attention");
    expect(msg).toContain("(1 overdue)");
    expect(msg).toContain("Cancel utilities — 29 Mtn Meadow — OVERDUE");
    expect(msg).toContain("Stop the payment — 404 Main St — due today");
    expect(msg).toContain("/transactions/tx1");
  });

  test("singular phrasing for one task, no overdue tag", () => {
    const msg = buildReminderMessage([
      { id: "1", title: "Order title", window: "d1", priority: "normal", property: "1 A St", transactionId: "tx1", alreadySent: [] },
    ]);
    expect(msg).toContain("1 task need"); // grammar aside, ensures singular branch
    expect(msg).not.toContain("overdue");
    expect(msg).toContain("due tomorrow");
  });

  test("duePhrase covers every window", () => {
    expect(duePhrase("overdue")).toBe("OVERDUE");
    expect(duePhrase("d0")).toBe("due today");
    expect(duePhrase("d1")).toBe("due tomorrow");
    expect(duePhrase("d3")).toBe("due in 3 days");
  });
});
