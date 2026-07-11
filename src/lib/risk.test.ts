import { test, expect, describe } from "bun:test";
import {
  classifyMilestone,
  classifyTask,
  isPostCloseNurture,
  isActiveRisk,
  severityFor,
} from "./risk";

describe("post-close nurture is NEVER active risk (§10 rule 1)", () => {
  test("review/gift/anniversary tasks classify as nurture", () => {
    for (const t of [
      "Conduct post-close review",
      "Post-close review",
      "Ask for a Google review",
      "Leave a Zillow review",
      "Closing anniversary gift",
      "Send NPS survey",
      "Thank-you note",
    ]) {
      expect(classifyTask(t)).toBe("post_close_nurture");
      expect(isActiveRisk(classifyTask(t))).toBe(false);
    }
  });
  test("nurture severity is always low", () => {
    expect(severityFor({ category: "post_close_nurture", daysToDue: -30 })).toBe("low");
  });
});

describe("contractual + closing classification", () => {
  test("milestone types map correctly", () => {
    expect(classifyMilestone("inspection")).toBe("contractual_deadline");
    expect(classifyMilestone("earnest_money")).toBe("contractual_deadline");
    expect(classifyMilestone("closing")).toBe("closing_blocker");
    expect(classifyMilestone("financing_approval")).toBe("closing_blocker");
    expect(classifyMilestone("walkthrough")).toBe("operational_work");
  });
  test("a post-close-labeled milestone overrides its type", () => {
    expect(classifyMilestone("walkthrough", "Post-close review")).toBe("post_close_nurture");
  });
  test("compliance + closing tasks", () => {
    expect(classifyTask("Submit to broker compliance")).toBe("compliance_blocker");
    expect(classifyTask("Order title commitment")).toBe("closing_blocker");
    expect(classifyTask("Confirm funds to close")).toBe("closing_blocker");
    expect(classifyTask("Welcome the client")).toBe("operational_work");
  });
});

describe("severity reflects proximity + confidence (§10)", () => {
  test("overdue contractual = critical", () => {
    expect(severityFor({ category: "contractual_deadline", daysToDue: -1 })).toBe("critical");
  });
  test("low-confidence overdue de-escalates to high (needs review)", () => {
    expect(severityFor({ category: "contractual_deadline", daysToDue: -1, confidence: 0.3 })).toBe("high");
  });
  test("within a week = high, further out = normal", () => {
    expect(severityFor({ category: "closing_blocker", daysToDue: 5 })).toBe("high");
    expect(severityFor({ category: "closing_blocker", daysToDue: 20 })).toBe("normal");
  });
});

describe("isPostCloseNurture", () => {
  test("detects, and doesn't false-positive on contractual work", () => {
    expect(isPostCloseNurture("Post-close review")).toBe(true);
    expect(isPostCloseNurture("Inspection deadline")).toBe(false);
    expect(isPostCloseNurture("Order title")).toBe(false);
  });
});
