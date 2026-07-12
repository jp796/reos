# REOS_04 — Final State-Consistency Verification Report

> **Version:** 1.2 FINAL · **Date:** 2026-07-12
> **Scope:** The three state-consistency defects live verification exposed after the v1.1 closure, plus report accuracy.
> **Status:** ✅ All defects corrected, deployed, and **live-verified** on the representative transaction and Today. No contradictory state remains visible.
> **Commit:** `da55c48` (single, independently revertible)

---

## 1. Executive summary

v1.1 wired every panel to the canonical `transactionState()` model, but live
Interceptor verification found the *model itself* produced three contradictions
on legacy deals:

```
Header:        No contract read yet
Current state: Reconciled across all documents · synced 17h ago
Synthesis:     Read 1/1 docs
Footer:        Never synced
```

All three are now fixed at the derivation level (not cosmetically hidden) and
verified live. The representative deal (**1650 North Ridge Dr**) now reads:

```
Header:        (no "contract read" nag — extraction resolves to "Contract on file")
Current state: Documents reconciled · 18h ago
Synthesis:     Read 1/1 docs
Footer:        Gmail never synced
```

---

## 2. Root causes (exact)

### Defect 1 — "No contract read yet" beside "Read 1/1 docs"
`extractionState()` recognized only three signals: `contractAppliedAt`,
`pendingContractJson`, `contractExtractedAt`. On deals created **before** the
`contractAppliedAt` field was stamped, all three are null — so a deal with a
stored, analyzed contract, a reconciliation timestamp, and six extracted
milestones fell through to the terminal `not_started` → "No contract read yet".
The synthesis panel meanwhile read the documents directly and correctly showed
"Read 1/1 docs". Two surfaces, two data paths, one contradiction.

### Defect 2 — generic "synced 17h ago" next to generic "Never synced"
`reconciliationState()` used "Reconciled … " rendered by the panel as
"· synced 17h ago", while `commsSyncState()` used the bare word "Never synced".
Two **different domains** (document reconciliation vs. Gmail inbox sync) both
spoke of "synced" without naming which, so on any reconciled-but-Gmail-unsynced
deal they read as a direct contradiction. (11 of 43 deals were in this state.)

### Defect 3 — a harm deal reappearing under "Other overdue milestones"
The v1.1 dedup excluded the **harm milestone id** from the secondary list, but a
deal in Prevent harm keeps its *other* overdue milestones — those leaked into
"Other overdue milestones", so the same deal appeared in two actionable
sections.

---

## 3. Corrections

### Defect 1 — durable-evidence legacy fallback (derivation fix)
`extractionState()` now has a documented evidence hierarchy. New branch: **a
real contract document on file AND (a reconciliation timestamp OR extracted
milestones) → "Contract on file" (`current`)**. This is a true, non-actionable
state — never a false "approved" claim. It is gated on a new
`hasContractDocument` input, so the **26 real doc-less leads** with a stray
milestone stay correctly "No contract read yet". Added intermediate states:
"Contract received — not yet read" (doc present, unprocessed) and a clearer
"Reading the contract…".

### Defect 2 — domain-named labels
- Reconciliation: "Documents reconciled" / "Documents not reconciled yet" /
  "New document not yet reconciled" — **never the bare word "synced"**.
- Gmail: "Gmail synced" / "Gmail never synced" / "Gmail not connected".
- The synthesis-panel state line now appends "· 18h ago" (no "synced"), and the
  footer renders the Gmail-domain label.

### Defect 3 — deal-prioritized rollup
New shared pure helper `overdueDealRollup()` excludes **every** milestone of a
harm deal from the secondary list and reports each harm deal's extra overdue
count, rendered as **"+N additional issues on this deal →"** inside the primary
harm item. One deal → one primary attention spot.

---

## 4. Changed files

| File | Change |
|---|---|
| `src/lib/transactionState.ts` | `hasContractDocument` input; rewritten `extractionState` (legacy fallback); domain-named reconciliation + comms labels |
| `src/app/transactions/[id]/page.tsx` | compute `hasContractDocument` (contract/analyzed doc count); pass into the state input |
| `src/app/transactions/[id]/DealSynthesisPanel.tsx` | state line says "· {time}" not "· synced {time}" |
| `src/app/today/page.tsx` | deal-level dedup via `overdueDealRollup`; "+N additional issues" on harm rows |
| `src/lib/todayQueues.ts` | new `overdueDealRollup()` pure helper |
| `src/lib/transactionState.test.ts` | REOS_04 legacy-fixture semantic tests; doc-less-gate tests; updated label assertions |
| `src/lib/todayQueues.test.ts` | 3-overdue-milestones-on-one-deal rollup tests |

## 5. Test cases added (exercise the real view-model, not source text)

- **Legacy fixture** (one analyzed contract doc + reconciled + 6 milestones +
  Gmail never synced + no approval field) proves it **cannot** render: "No
  contract read yet"; a bare "synced"/"Never synced"; "reconciled" without a
  timestamp; "No AI brief yet" when a brief exists; "Gmail synced/current" while
  disconnected or never synced.
- **Doc-less gate**: a lead with a stray milestone but no document stays "No
  contract read yet"; a contract on file but unprocessed → "Contract received —
  not yet read".
- **Today rollup**: a deal with **three** overdue milestones appears once in
  harm with "+2 additional issues"; its milestones are excluded from the
  secondary list; a single-milestone deal rolls up to "+0".

## 6. Verification results

- **`bun test`** → **79 pass, 0 fail** (308 assertions) across 20 files.
- **`bunx tsc --noEmit`** → clean.
- **`bun run build`** → clean (full route table emitted).
- **Pre-deploy data check**: ran the canonical derivation against the real DB
  inputs for 1650 North Ridge and 29 Mtn Meadow — both produce mutually
  compatible, domain-named states.

## 7. Live Interceptor evidence

**Representative transaction — `/transactions/cmqwt2kd…` (1650 North Ridge Dr):**
- "Current state: **Documents reconciled · 18h ago**"
- "Read 1/1 docs. 5 contingencies…"
- Footer: "… · **Gmail never synced**"
- Text scan: **"No contract read yet" count = 0**; bare "Never synced" / "· synced Nh" count = **0**.
- Screenshot: `docs/reos04-evidence/txn-1650-northridge-state.png`.

**Today — `/today`:**
- "🚨 Prevent harm · 7" with items showing "**+1 additional overdue issue on this deal →**" and "**+3 additional overdue issues on this deal →**".
- "Other overdue milestones" → "**Nothing else overdue. Good place to be.**" (harm deals' extras rolled up, not duplicated).
- Screenshot: `docs/reos04-evidence/today-harm-rollup.png`.

## 8. Remaining limitations

1. The header shows a contract-state badge only for **actionable** extraction
   states (needs-review / not-read / received). "Contract on file" and "reviewed
   + applied" are healthy states and intentionally render no badge — this is the
   corrected derivation, not a cosmetic hide.
2. This correction touches only state semantics + Today dedup. `review_opened`
   and `first_risk_created` remain **intentionally unwired** (no commitment
   point); no persisted Risk model was created, per scope.
3. 27 legacy deals had `contractAppliedAt` null; they now read correctly via the
   durable-evidence fallback at **read time** — no production rows were rewritten.

## 9. Commit

`da55c48` — "REOS_04: fix legacy extraction state + name sync domains + Today deal dedup". Independently revertible.
