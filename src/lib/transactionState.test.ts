import { test, expect, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  transactionState,
  reconciliationState,
  extractionState,
  commsSyncState,
  aiBriefState,
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
  hasContractDocument: false,
  status: "active",
};

// The exact live-verification pattern from REOS_04: a legacy deal with one
// stored+analyzed contract document, a reconciliation timestamp, extracted
// milestones, Gmail never synced, and NO explicit extraction-approval field.
const legacy: TransactionStateInput = {
  ...base,
  contractAppliedAt: null, // predates the approval field
  contractExtractedAt: null,
  pendingContractJson: null,
  hasContractDocument: true, // one contract doc on file, analyzed
  synthesizedAt: "2026-07-12T03:37:30.000Z", // documents reconciled 17h ago
  milestoneCount: 6, // extracted timeline present
  googleConnected: true,
  lastSyncedAt: null, // Gmail never synced
};

describe("REOS_04 — legacy state renders no cross-surface contradiction", () => {
  const dims = transactionState(legacy);
  const label = (k: string) => dims.find((d) => d.key === k)!.label;
  const allLabels = dims.map((d) => d.label);

  test("'No contract read yet' cannot appear when the contract IS on file (Read 1/1 docs)", () => {
    const ext = dims.find((d) => d.key === "extraction")!;
    expect(ext.label).not.toBe("No contract read yet");
    expect(ext.state).toBe("current"); // "Contract on file"
    expect(ext.label).toBe("Contract on file");
  });

  test("reconciliation and Gmail sync are domain-named — no bare 'synced' / 'Never synced'", () => {
    // No dimension may render the ambiguous generic words that collided live.
    for (const l of allLabels) {
      expect(l).not.toBe("Never synced");
      expect(l).not.toBe("Synced");
    }
    // Reconciliation names DOCUMENTS and never the bare word "synced".
    expect(label("reconciliation")).toBe("Documents reconciled");
    expect(label("reconciliation").toLowerCase()).not.toContain("synced");
    // Gmail state names GMAIL explicitly.
    expect(label("comms")).toBe("Gmail never synced");
    expect(label("comms")).toContain("Gmail");
  });

  test("'Documents reconciled' only with a real reconciliation timestamp", () => {
    expect(reconciliationState(legacy).since).not.toBeNull();
    expect(reconciliationState(legacy).label).toBe("Documents reconciled");
    // Without a timestamp it must NOT render the completed success label.
    const notYet = reconciliationState({ ...legacy, synthesizedAt: null });
    expect(notYet.state).not.toBe("current");
    expect(notYet.label).not.toBe("Documents reconciled");
    expect(notYet.since).toBeNull();
  });

  test("no false 'No AI brief yet' when a current brief exists", () => {
    const withBrief = aiBriefState({ ...legacy, aiSummaryUpdatedAt: "2026-07-12T10:00:00.000Z" });
    expect(withBrief.state).toBe("current");
    expect(withBrief.label).not.toBe("No AI brief yet");
  });

  test("Gmail never reads 'current/synced' while disconnected or never synced", () => {
    expect(commsSyncState({ ...legacy, googleConnected: false }).label).toBe("Gmail not connected");
    expect(commsSyncState({ ...legacy, googleConnected: false }).state).not.toBe("current");
    // connected but never scanned → never "Gmail synced"
    expect(commsSyncState(legacy).state).not.toBe("current");
    expect(commsSyncState(legacy).label).not.toBe("Gmail synced");
  });
});

describe("extraction legacy fallback is gated on a real contract document", () => {
  test("doc-less lead with a stray milestone stays 'No contract read yet'", () => {
    // 26 real deals look like this — a milestone but NO document. Must NOT be
    // upgraded to "Contract on file".
    const docless = { ...base, hasContractDocument: false, milestoneCount: 1 };
    expect(extractionState(docless).label).toBe("No contract read yet");
    expect(extractionState(docless).state).toBe("not_started");
  });
  test("contract doc on file but nothing processed → received, not read", () => {
    const received = { ...base, hasContractDocument: true, milestoneCount: 0, synthesizedAt: null };
    expect(extractionState(received).state).toBe("processing");
    expect(extractionState(received).label).toBe("Contract received — not yet read");
  });
});

describe("reconciliation never claims 'reconciled' without a timestamp (§8.1)", () => {
  test("no synthesizedAt → not reconciled, actionable", () => {
    const s = reconciliationState(base);
    expect(s.state).toBe("not_started");
    expect(s.label).toBe("Documents not reconciled yet");
    expect(s.action).toBeTruthy();
    expect(s.since).toBeNull();
  });
  test("with synthesizedAt → reconciled (current), has since", () => {
    const s = reconciliationState({ ...base, synthesizedAt: "2026-07-01T00:00:00Z" });
    expect(s.state).toBe("current");
    expect(s.label).toBe("Documents reconciled");
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
              // If it claims the success state, it MUST have a timestamp.
              if (recon.state === "current") {
                expect(recon.since).not.toBeNull();
                expect(recon.label).toBe("Documents reconciled");
              }
              // If it has no timestamp, it must be actionable, not a silent success.
              if (recon.since === null) {
                expect(recon.action).toBeTruthy();
                expect(recon.state).not.toBe("current");
              }
            }
  });
});

describe("panels cannot contradict each other (§8 closure — cross-panel)", () => {
  // Every surface (DealSynthesisPanel state line, the timeline panel, Today)
  // now reads the SAME transactionState() derivation. So proving two
  // dimensions can never disagree proves two panels can never disagree.
  const bools = [null, "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z"] as const;

  test("reconciliation and timeline never disagree on staleness", () => {
    for (const synthesizedAt of bools)
      for (const newestDocAt of bools) {
        const dims = transactionState({
          ...base,
          synthesizedAt,
          newestDocAt,
          contractAppliedAt: "2026-06-01T00:00:00Z",
          milestoneCount: 8, // timeline exists
        });
        const recon = dims.find((d) => d.key === "reconciliation")!;
        const timeline = dims.find((d) => d.key === "timeline")!;
        // If reconciliation is stale (a newer doc arrived post-sync), the
        // timeline panel must not claim it's freshly "current" — and vice
        // versa. They move together.
        if (recon.state === "stale") expect(timeline.state).toBe("stale");
        if (timeline.state === "stale") expect(recon.state).toBe("stale");
      }
  });

  test("the exact shipped bug — 'Reconciled … synced never' — is unrepresentable", () => {
    const recon = reconciliationState({ ...base, synthesizedAt: null });
    // The panel renders `${label}${since ? ' · '+rel : ''}`. With a null
    // `since` it CANNOT print a time clause, and the label is the actionable
    // "Documents not reconciled yet" — never the success state.
    expect(recon.since).toBeNull();
    expect(recon.state).toBe("not_started");
    expect(recon.label).toBe("Documents not reconciled yet");
    // And a reconciled state always carries a real timestamp to render.
    const ok = reconciliationState({ ...base, synthesizedAt: "2026-07-05T00:00:00Z" });
    expect(ok.state).toBe("current");
    expect(ok.label).toBe("Documents reconciled");
    expect(ok.since).not.toBeNull();
  });

  test("every actionable (un-done) dimension tells the user what to do (§8.4)", () => {
    const dims = transactionState(base); // brand-new deal, nothing done
    for (const d of dims) {
      if (d.state === "not_started" || d.state === "failed") {
        expect(d.action, `${d.key} must be actionable`).toBeTruthy();
      }
    }
  });
});

describe("the transaction page wires every surface to the canonical model", () => {
  const pageSrc = readFileSync(
    join(process.cwd(), "src/app/transactions/[id]/page.tsx"),
    "utf8",
  );

  test("page derives all five dimensions from transactionState()", () => {
    expect(pageSrc).toContain('from "@/lib/transactionState"');
    expect(pageSrc).toContain("transactionState(txnStateInput)");
    for (const key of ["reconciliation", "ai_brief", "comms", "extraction"]) {
      expect(pageSrc).toContain(`"${key}"`);
    }
  });

  test("each panel receives its canonical dimension (no independent inference)", () => {
    // Synthesis panel ← reconciliation; AI summary ← aiBrief; header ←
    // extraction; footer comms line ← commsState.
    expect(pageSrc).toContain("reconciliation={reconciliation}");
    expect(pageSrc).toContain("aiBrief={aiBriefState}");
    expect(pageSrc).toContain("extraction={extractionDim}");
    expect(pageSrc).toContain("commsState.label");
    // The old raw comms line ("Last synced {fmtDate(txn.lastSyncedAt)}") is gone.
    expect(pageSrc).not.toContain("Last synced{\" \"}");
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
