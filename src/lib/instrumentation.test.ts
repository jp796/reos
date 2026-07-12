import { test, expect, describe } from "bun:test";
import type { PrismaClient } from "@prisma/client";
import {
  sanitizeMeta,
  buildEventRecord,
  logWorkflowEvent,
  WORKFLOW_EVENTS,
} from "./instrumentation";

/** A fake Prisma that records what logWorkflowEvent tries to persist. */
function fakeDb() {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    automationAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;
  return { db, writes };
}

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

describe("event emission (proves the wiring persists a real, scoped record)", () => {
  test("logWorkflowEvent writes an account-scoped, sanitized audit row", async () => {
    const { db, writes } = fakeDb();
    await logWorkflowEvent(db, {
      accountId: "acct_1",
      transactionId: "txn_1",
      event: "facts_approved",
      actorUserId: "user_1",
      meta: { side: "sell", token: "SHOULD_NOT_PERSIST" },
    });
    expect(writes).toHaveLength(1);
    const row = writes[0]!;
    // Account-scoped (§15: events must be account-scoped).
    expect(row.accountId).toBe("acct_1");
    expect(row.transactionId).toBe("txn_1");
    expect(row.ruleName).toBe("golden:facts_approved");
    expect(row.actorUserId).toBe("user_1");
    // Secrets never persist even when a caller passes them.
    const after = row.afterJson as Record<string, unknown>;
    expect(after.side).toBe("sell");
    expect(after.token).toBeUndefined();
  });

  test("account-less funnel entry (intake) persists with a null transaction", async () => {
    const { db, writes } = fakeDb();
    await logWorkflowEvent(db, {
      accountId: "acct_2",
      event: "intake_started",
      meta: { files: 2 },
    });
    expect(writes[0]!.accountId).toBe("acct_2");
    expect(writes[0]!.transactionId).toBeNull();
    expect(writes[0]!.ruleName).toBe("golden:intake_started");
  });

  test("instrumentation NEVER throws into the caller (db failure is swallowed)", async () => {
    const db = {
      automationAuditLog: {
        create: async () => {
          throw new Error("db down");
        },
      },
    } as unknown as PrismaClient;
    // Must resolve, not reject — a broken analytics write can't break a workflow.
    await expect(
      logWorkflowEvent(db, {
        accountId: "a",
        event: "transaction_closed",
      }),
    ).resolves.toBeUndefined();
  });
});
