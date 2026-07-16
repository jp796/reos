import { test, expect, describe } from "bun:test";
import { boundDueDate } from "./ProjectEngine";

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");

describe("boundDueDate — anchor + window flagging (decision 3)", () => {
  const start = d("2026-01-01");
  const end = d("2026-03-08"); // start + 66 days ≈ flip window

  test("in-window offset is not flagged and lands on the right day", () => {
    const r = boundDueDate(start, 30, end);
    expect(r.outOfWindow).toBe(false);
    expect(r.dueAt.toISOString().slice(0, 10)).toBe("2026-01-31");
  });
  test("offset past the window end is FLAGGED (not silently clamped)", () => {
    const r = boundDueDate(start, 90, end);
    expect(r.outOfWindow).toBe(true);
    // date is preserved, not clamped, so the TC can see how far it overflows
    expect(r.dueAt.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
  test("offset exactly on the window boundary is in-window", () => {
    expect(boundDueDate(start, 66, end).outOfWindow).toBe(false);
  });
  test("negative offset (before the anchor) is flagged", () => {
    expect(boundDueDate(start, -1, end).outOfWindow).toBe(true);
  });
});
