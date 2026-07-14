import { test, expect, describe } from "bun:test";
import type { PrismaClient } from "@prisma/client";
import {
  recordCorrection,
  getActiveRules,
  ruleTextFor,
  isLearnableField,
  rulesPromptBlock,
  PROMOTE_THRESHOLD,
} from "./ExtractionLearningService";

/** In-memory fake of the extractionLearning table. */
function fakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  let id = 0;
  const db = {
    extractionLearning: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find(
          (r) =>
            r.accountId === where.accountId &&
            r.state === where.state &&
            r.docType === where.docType &&
            r.field === where.field,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `l${++id}`, ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        return rows.filter((r) => {
          if (r.accountId !== where.accountId) return false;
          if (where.active !== undefined && r.active !== where.active) return false;
          if (where.docType !== undefined && r.docType !== where.docType) return false;
          if (Array.isArray(where.OR)) {
            const ok = where.OR.some((c: { state: unknown }) => c.state === r.state);
            if (!ok) return false;
          }
          return true;
        });
      },
    },
  } as unknown as PrismaClient;
  return { db, rows };
}

describe("Layer 2 — corrections promote to injectable rules", () => {
  test("a single correction is captured but NOT yet an active rule", async () => {
    const { db, rows } = fakeDb();
    await recordCorrection(db, { accountId: "a1", state: "WY", field: "sellers", corrected: "added 2nd seller" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.weight).toBe(1);
    expect(rows[0]!.active).toBe(false);
    // nothing injected yet
    expect(await getActiveRules(db, { accountId: "a1", state: "WY" })).toHaveLength(0);
  });

  test(`the same correction recurring to the threshold (${PROMOTE_THRESHOLD}) promotes to an active rule`, async () => {
    const { db, rows } = fakeDb();
    for (let i = 0; i < PROMOTE_THRESHOLD; i++) {
      await recordCorrection(db, { accountId: "a1", state: "WY", field: "sellers" });
    }
    expect(rows).toHaveLength(1); // deduped by (account,state,docType,field)
    expect(rows[0]!.weight).toBe(PROMOTE_THRESHOLD);
    expect(rows[0]!.active).toBe(true);
    expect(rows[0]!.kind).toBe("rule");

    const rules = await getActiveRules(db, { accountId: "a1", state: "WY" });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain("EVERY seller");
    expect(rules[0]).toContain("WY");
  });

  test("rules are scoped: a WY rule is not injected for an MO contract", async () => {
    const { db } = fakeDb();
    for (let i = 0; i < PROMOTE_THRESHOLD; i++) {
      await recordCorrection(db, { accountId: "a1", state: "WY", field: "sellers" });
    }
    expect(await getActiveRules(db, { accountId: "a1", state: "MO" })).toHaveLength(0);
    expect(await getActiveRules(db, { accountId: "a1", state: "WY" })).toHaveLength(1);
    // a different account never sees it
    expect(await getActiveRules(db, { accountId: "a2", state: "WY" })).toHaveLength(0);
  });

  test("state-agnostic rules inject for any state", async () => {
    const { db } = fakeDb();
    for (let i = 0; i < PROMOTE_THRESHOLD; i++) {
      await recordCorrection(db, { accountId: "a1", state: null, field: "side" });
    }
    expect(await getActiveRules(db, { accountId: "a1", state: "MO" })).toHaveLength(1);
  });

  test("non-learnable fields (unique per deal) are ignored", async () => {
    const { db, rows } = fakeDb();
    await recordCorrection(db, { accountId: "a1", state: "WY", field: "propertyAddress", corrected: "123 Main" });
    await recordCorrection(db, { accountId: "a1", state: "WY", field: "zip", corrected: "82001" });
    expect(rows).toHaveLength(0);
    expect(isLearnableField("propertyAddress")).toBe(false);
    expect(isLearnableField("sellers")).toBe(true);
  });

  test("learning never throws into the caller (db failure swallowed)", async () => {
    const db = {
      extractionLearning: {
        findFirst: async () => {
          throw new Error("db down");
        },
      },
    } as unknown as PrismaClient;
    await expect(
      recordCorrection(db, { accountId: "a", state: "WY", field: "sellers" }),
    ).resolves.toBeUndefined();
    expect(await getActiveRules(db, { accountId: "a", state: "WY" })).toEqual([]);
  });
});

describe("rule text + prompt block", () => {
  test("rule text names the field + state and reads like an instruction", () => {
    expect(ruleTextFor("sellers", "WY")).toContain("EVERY seller");
    expect(ruleTextFor("buyers_agent", "MO")).toContain("BOTH sides' agents");
    expect(ruleTextFor("side", null)).toContain("drafting/footer agent");
  });
  test("prompt block is empty with no rules, bulleted otherwise", () => {
    expect(rulesPromptBlock([])).toBe("");
    const block = rulesPromptBlock(["Rule A", "Rule B"]);
    expect(block).toContain("LEARNED CORRECTIONS");
    expect(block).toContain("- Rule A");
    expect(block).toContain("- Rule B");
  });
});
