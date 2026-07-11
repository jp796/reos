import { test, expect, describe } from "bun:test";
import {
  transactionState,
  reconciliationState,
  extractionState,
  type TransactionStateInput,
} from "./transactionState";

const base: TransactionStateInput = {
  contractExtractedAt: null,
  contractAppliedAt: null,
  pendingContractJson: null,
  synthesizedAt: null,
  lastSyncedAt: null,
  googleConnected: false,
  aiSummaryUpdatedAt: null,
  milestoneCount: 0,
  newestDocAt: null,
  status: "active",
};

describe("reconciliation never claims 'reconciled' without a timestamp (§8.1)", () => {
  test("no synthesizedAt → 'Not synced yet', actionable, never 'reconciled'", () => {
    const s = reconciliationState(base);
    expect(s.state).toBe("not_started");
    expect(s.label).not.toContain("Reconciled");
    expect(s.action).toBeTruthy();
    expect(s.since).toBeNull();
  });
  test("with synthesizedAt → 'Reconciled', has since", () => {
    const s = reconciliationState({ ...base, synthesizedAt: "2026-07-01T00:00:00Z" });
    expect(s.state).toBe("current");
    expect(s.label).toContain("Reconciled");
    expect(s.since).toBe("2026-07-01T00:00:00Z");
  });
  test("newer doc after sync → stale, actionable", () => {
    const s = reconciliationState({
      ...base,
      synthesizedAt: "2026-07-01T00:00:00Z",
      newestDocAt: "2026-07-05T00:00:00Z",
    });
    expect(s.state).toBe("stale");
    expect(s.action).toBeTruthy();
  });
});

describe("no valid DB state renders a contradiction (§8 acceptance)", () => {
  // Enumerate the cross-product of the material timestamp flags.
  const bools = [null, "2026-07-01T00:00:00Z"] as const;
  test("'reconciled' + 'never synced' is impossible for every combination", () => {
    for (const synthesizedAt of bools)
      for (const lastSyncedAt of bools)
        for (const contractAppliedAt of bools)
          for (const newestDocAt of bools)
            for (const googleConnected of [true, false]) {
              const dims = transactionState({
                ...base,
                synthesizedAt,
                lastSyncedAt,
                contractAppliedAt,
                newestDocAt,
                googleConnected,
                milestoneCount: contractAppliedAt ? 8 : 0,
              });
              const recon = dims.find((d) => d.key === "reconciliation")!;
              // If it claims reconciled, it MUST have a timestamp.
              if (recon.label.includes("Reconciled")) {
                expect(recon.since).not.toBeNull();
              }
              // If it has no timestamp, it must be actionable (not a silent success).
              if (recon.since === null) {
                expect(recon.action).toBeTruthy();
                expect(recon.label).not.toContain("Reconciled");
              }
            }
  });
});

describe("extraction review gate (§6.4 human approval)", () => {
  test("pending extraction → needs_review with an action", () => {
    const s = extractionState({ ...base, contractExtractedAt: "2026-07-01T00:00:00Z", pendingContractJson: { a: 1 } });
    expect(s.state).toBe("needs_review");
    expect(s.action).toBeTruthy();
  });
  test("applied → current, no action", () => {
    const s = extractionState({ ...base, contractAppliedAt: "2026-07-02T00:00:00Z" });
    expect(s.state).toBe("current");
    expect(s.action).toBeNull();
  });
});
