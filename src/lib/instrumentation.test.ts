import { test, expect, describe } from "bun:test";
import { sanitizeMeta, buildEventRecord, WORKFLOW_EVENTS } from "./instrumentation";

describe("no PII / secrets / blobs in analytics (§15)", () => {
  test("forbidden keys are stripped", () => {
    const out = sanitizeMeta({
      token: "abc",
      password: "x",
      rawBytes: "…",
      documentContent: "the whole contract",
      buyerSsn: "123-45-6789",
      accountNumber: "4823",
      okCount: 12,
    });
    expect(out.token).toBeUndefined();
    expect(out.password).toBeUndefined();
    expect(out.rawBytes).toBeUndefined();
    expect(out.documentContent).toBeUndefined();
    expect(out.buyerSsn).toBeUndefined();
    expect(out.accountNumber).toBeUndefined();
    expect(out.okCount).toBe(12);
  });
  test("objects/arrays/blobs dropped; strings truncated", () => {
    const out = sanitizeMeta({
      nested: { a: 1 },
      list: [1, 2, 3],
      note: "x".repeat(500),
      side: "buy",
      ok: true,
    });
    expect(out.nested).toBeUndefined();
    expect(out.list).toBeUndefined();
    expect((out.note as string).length).toBe(120);
    expect(out.side).toBe("buy");
    expect(out.ok).toBe(true);
  });
});

describe("event record", () => {
  test("uses reserved golden: ruleName + sanitizes meta", () => {
    const rec = buildEventRecord({
      accountId: "acct",
      transactionId: "txn",
      event: "extraction_completed",
      meta: { fields: 15, token: "leak" },
    });
    expect(rec.ruleName).toBe("golden:extraction_completed");
    expect(rec.entityType).toBe("workflow_event");
    expect((rec.afterJson as Record<string, unknown>).fields).toBe(15);
    expect((rec.afterJson as Record<string, unknown>).token).toBeUndefined();
  });
  test("all 14 funnel events are defined", () => {
    expect(WORKFLOW_EVENTS.length).toBe(14);
    expect(WORKFLOW_EVENTS).toContain("transaction_closed");
    expect(WORKFLOW_EVENTS).toContain("first_risk_created");
  });
});
