import { test, expect, describe } from "bun:test";
import { assignTodayQueues } from "./todayQueues";

// Minimal row shapes — mirror what page.tsx passes, string-keyed for tests.
interface M { id: string; txn: string; type: string; label: string }
interface T { id: string; txn: string; title: string }
interface S { txn: string }
interface R { txn: string; score: number }

const accessors = {
  milestoneTxn: (m: M) => m.txn,
  milestoneType: (m: M) => m.type,
  milestoneLabel: (m: M) => m.label,
  taskTxn: (t: T) => t.txn,
  taskTitle: (t: T) => t.title,
  silentTxn: (s: S) => s.txn,
  scoredTxn: (r: R) => r.txn,
};

function run(input: {
  overdueMilestones?: M[];
  overdueTasks?: T[];
  silentDeals?: S[];
  scoredRisky?: R[];
}) {
  return assignTodayQueues({
    overdueMilestones: input.overdueMilestones ?? [],
    overdueTasks: input.overdueTasks ?? [],
    silentDeals: input.silentDeals ?? [],
    scoredRisky: input.scoredRisky ?? [],
    accessors,
  });
}

describe("Today decision queues — one incident, one queue (§11 closure)", () => {
  test("overdue contractual milestone → Prevent harm", () => {
    const q = run({
      overdueMilestones: [{ id: "m1", txn: "A", type: "inspection", label: "Inspection deadline" }],
    });
    expect(q.harm.map((m) => m.id)).toEqual(["m1"]);
    expect(q.doToday).toHaveLength(0);
    expect(q.waiting).toHaveLength(0);
    expect(q.atRisk).toHaveLength(0);
  });

  test("overdue task on the SAME deal as a harm milestone does NOT double-list", () => {
    const q = run({
      overdueMilestones: [{ id: "m1", txn: "A", type: "closing", label: "Closing" }],
      overdueTasks: [{ id: "t1", txn: "A", title: "Order title" }],
    });
    // Deal A is in harm; its task must not also appear in Do today.
    expect(q.harm.map((m) => m.id)).toEqual(["m1"]);
    expect(q.doToday).toHaveLength(0);
  });

  test("overdue task on a DIFFERENT deal → Do today", () => {
    const q = run({
      overdueMilestones: [{ id: "m1", txn: "A", type: "inspection", label: "Inspection deadline" }],
      overdueTasks: [{ id: "t1", txn: "B", title: "Call the lender" }],
    });
    expect(q.harm.map((m) => m.txn)).toEqual(["A"]);
    expect(q.doToday.map((t) => t.id)).toEqual(["t1"]);
  });

  test("communication silence on a deal already in harm → not in Waiting", () => {
    const q = run({
      overdueMilestones: [{ id: "m1", txn: "A", type: "inspection", label: "Inspection deadline" }],
      silentDeals: [{ txn: "A" }],
    });
    expect(q.harm).toHaveLength(1);
    expect(q.waiting).toHaveLength(0);
  });

  test("communication silence on an otherwise-quiet deal → Waiting on others", () => {
    const q = run({ silentDeals: [{ txn: "C" }] });
    expect(q.waiting.map((s) => s.txn)).toEqual(["C"]);
  });

  test("closed transaction contributes nothing (caller passes only active rows)", () => {
    // The page queries status:"active", so a closed deal never reaches here.
    const q = run({ overdueMilestones: [], overdueTasks: [], silentDeals: [], scoredRisky: [] });
    expect(q.harm.length + q.doToday.length + q.waiting.length + q.atRisk.length).toBe(0);
  });

  test("post-close nurture task → its own lane, never Do today or At risk", () => {
    const q = run({
      overdueTasks: [{ id: "t1", txn: "D", title: "Send Zillow review request" }],
      scoredRisky: [{ txn: "D", score: 40 }],
    });
    expect(q.postClose.map((t) => t.id)).toEqual(["t1"]);
    expect(q.doToday).toHaveLength(0);
    // A post-close-only deal isn't "claimed", so the risk engine could still
    // surface it as informational — but it is NOT in an actionable queue.
    expect(q.atRisk.map((r) => r.txn)).toEqual(["D"]);
  });

  test("duplicate signals across all queues collapse to one primary item", () => {
    // Deal A has EVERYTHING: harm milestone + overdue task + silence + high score.
    const q = run({
      overdueMilestones: [{ id: "m1", txn: "A", type: "inspection", label: "Inspection deadline" }],
      overdueTasks: [{ id: "t1", txn: "A", title: "Follow up" }],
      silentDeals: [{ txn: "A" }],
      scoredRisky: [{ txn: "A", score: 90 }],
    });
    // Appears exactly once — in the highest queue (Prevent harm).
    expect(q.harm.map((m) => m.txn)).toEqual(["A"]);
    expect(q.doToday).toHaveLength(0);
    expect(q.waiting).toHaveLength(0);
    expect(q.atRisk).toHaveLength(0);
  });

  test("scored-risky deal with no actionable signal → informational At risk", () => {
    const q = run({ scoredRisky: [{ txn: "E", score: 30 }] });
    expect(q.atRisk.map((r) => r.txn)).toEqual(["E"]);
  });

  test("Prevent harm stays scarce — one incident per deal", () => {
    const q = run({
      overdueMilestones: [
        { id: "m1", txn: "A", type: "inspection", label: "Inspection deadline" },
        { id: "m2", txn: "A", type: "closing", label: "Closing" },
      ],
    });
    expect(q.harm).toHaveLength(1);
    expect(q.harm[0]!.id).toBe("m1");
  });
});
