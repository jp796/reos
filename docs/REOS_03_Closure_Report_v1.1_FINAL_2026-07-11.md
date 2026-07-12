# REOS_03 Remediation Closure — Final Report

> **Version:** 1.1 FINAL · **Date:** 2026-07-11
> **Source prompt:** `REOS_03_Remediation_Closure_Prompt_v1.1_2026-07-11.md`
> **Verification:** 67 tests green · `tsc --noEmit` clean · production build clean
> **Status:** 5 of 6 items complete; item 4 (state wiring) landed its primary
> surface + the contradiction guarantee, with remaining panels centralized for
> incremental wiring. Every item is an independently-reversible commit.

---

## Status legend

- ✅ **Completed** — implemented, tested, verified.
- 🟡 **Partially completed** — core delivered + guaranteed; documented remainder.
- ⚪ **Deferred / no commitment point** — precisely documented, not fabricated.

---

## 1. Public pricing consistency — ✅ Completed

**Problem:** the public marketing page hardcoded plan copy that had drifted from
the canonical `src/lib/plans.ts` — Team showed "Multi-user (unlimited)" and the
header said "Unlimited users", while the authoritative Team seat limit is 5.

**Change:** the pricing cards **and** the SEO offer schema now map over `PLANS`
(name / price / seats / features). The authoritative seat line renders from
`seatLabel(plan)`. No hardcoded plan copy remains on the page.

**Test:** `plans.test.ts` reads `page.tsx` and proves it derives from
`plans.ts`, that the stale strings are gone, and that the Team seat claim the
public page renders equals the server's `seatLimitReached` enforcement.

Commit: `596b387`.

## 2. Today queue deduplication — ✅ Completed

**Problem:** one transaction's problem showed in "Prevent harm" AND the scored
"At risk" list AND "Waiting on others" — Today read as a report, not a queue.

**Change:** new pure `assignTodayQueues()` (`src/lib/todayQueues.ts`) assigns
each active deal to exactly ONE primary queue by precedence:

```
Prevent harm > Do today > Waiting on others > informational
```

Post-close nurture keeps its own lane. "At risk" is reframed as "Also worth
watching", moved last, and shows only deals not already surfaced. "Overdue
milestones" excludes the harm milestones shown in Prevent harm. The "Silent"
KPI now reflects the deduped waiting count.

**Tests:** `todayQueues.test.ts` — 10 tests covering the required cases: overdue
contractual milestone, overdue task (same + different deal), silence (claimed +
unclaimed), closed transaction (contributes nothing), post-close nurture lane,
and duplicate signals collapsing to one primary queue item.

Commit: `a0ac540`.

## 3. Golden-workflow instrumentation — ✅ Completed (12 wired + 1 existing; 2 documented)

Only `transaction_closed` was wired. Every applicable event now fires at its
real commitment point, account-scoped, meta sanitized (no content/PII), never
blocking the workflow, de-duplicated on retries:

| Event | Commitment point |
|---|---|
| `intake_started` | extract-contracts-stream (upload entry) |
| `attachment_received` | extract-contracts-stream + documents upload route |
| `extraction_started` / `_completed` / `_failed` | contract/extract |
| `facts_approved` | create-from-scan (deal persisted) |
| `timeline_approved` | create-from-scan (milestones created) |
| `tasks_activated` | create-from-scan (investor) + generate-tasks (retail) |
| `risk_resolved` | milestone complete — harm→done **transition only** |
| `compliance_review_ready` | send-to-rezen (on real push) |
| `compliance_exported` | compliance bundle download |
| `transaction_closed` | status route — now guarded to the transition only |

**⚪ No real commitment point (documented, not fabricated):**
- `review_opened` — the review UI is client-only; there is no server action that
  uniquely marks "the user opened the review". Wiring a GET would fire on every
  render and mislead. Left unwired by design.
- `first_risk_created` — risk is **computed on the fly** by `RiskScoringService`
  and never persisted, so there is no creation event to hook. It would require a
  new persisted-risk model, which is out of scope for this closure.

**Idempotency:** `transaction_closed` and `risk_resolved` fire only on the state
transition; re-saving an already-terminal deal or re-completing a milestone
emits nothing.

**Tests:** `instrumentation.test.ts` — emission tests with a fake Prisma prove a
scoped, sanitized row is written, that an account-less intake persists with a
null transaction, and that a DB failure never throws into the caller.

Commit: `751cbbd`.

## 4. Transaction-state wiring — 🟡 Partially completed

**Problem:** `src/lib/transactionState.ts` (the canonical state view-model) was
built in the prior remediation but **entirely unused** — every panel still
inferred its own state. `DealSynthesisPanel` derived "Reconciled across all
documents" from `synthesizedAt` alone, ignoring staleness.

**Change (delivered):** the transaction page computes the canonical
`transactionState()` once — including the newest document timestamp (staleness)
and Gmail-connected — and passes the reconciliation `DimensionState` into
`DealSynthesisPanel`, which now renders its state line (label / tone / action)
straight from the model. No independent inference remains in that panel; a newer
doc after sync now correctly reads "New document not yet reconciled".

**Tests:** `transactionState.test.ts` — cross-panel invariants prove
reconciliation and timeline never disagree on staleness, the shipped
"Reconciled · synced never" combination is unrepresentable, and every
un-done dimension is actionable.

**Remaining (centralized, incremental):** the header badge, AI-summary panel,
and comms-sync line still render their own field values. They no longer
contradict the synthesis panel (all read the same underlying timestamps), and
`transactionState()` is now the one derivation available to wire each in turn.
Full per-panel migration is a mechanical follow-up, not a new design.

Commit: `e5bbdc8`.

## 5. Public capability truthfulness — ✅ Completed

**Problem:** the public page overstated two capabilities vs
`src/lib/capabilities.ts`:
- "posts listings to FB / Instagram / LinkedIn" implied native auto-posting, but
  social adapters are `assisted` (copy-paste).
- "Any brokerage · Rezen / Skyslope / Dotloop" implied three live integrations;
  only Rezen is wired (Skyslope / Dotloop are roadmap).

**Change:** social copy → "generates ready-to-post listing captions"; the KPI →
"Rezen-native · others configurable". Strong marketing language preserved; the
claims are now accurate. The FAQ ("captions generate today … ready to paste")
was already honest.

**Tests:** `capabilities.test.ts` reads `page.tsx` and enforces: social is
paste/generate (not native posting), stub integrations (Buffer, MLS) aren't
advertised present-tense, non-registry systems aren't listed as live, and Rezen
stays `available` (not falsely `operational`).

Commit: `751714c`.

## 6. Report accuracy — ✅ This document

Separated completed / partially completed / deferred. `docs/REMEDIATION_REPORT.md`
carried a blanket "Phases 1–10 complete" claim; the deferred section there is
now superseded by the closure work above, and the one genuinely partial item
(state wiring) is labeled as such rather than claimed complete.

---

## Verification evidence

- **Tests:** `bun test` → **67 pass, 0 fail** across 20 files (242 assertions).
  New/extended in this closure: `plans` (+3), `todayQueues` (10 new),
  `instrumentation` (+3), `transactionState` (+3), `capabilities` (+4).
- **Typecheck:** `bunx tsc --noEmit` → clean.
- **Production build:** `bun run build` → clean (full route table emitted).
- **Data safety:** no schema-destructive migrations; no production records
  rewritten in this closure. (The separate document-read backfill only filled
  empty `analysisJson` fields by re-reading PDFs already stored — no field was
  overwritten.)
- **Live verification:** deployed to Cloud Run; public pricing + Today verified
  (see the session log / screenshots accompanying this report).

## Commit hashes

| Item | Commit |
|---|---|
| 1 — public pricing | `596b387` |
| 2 — Today dedup | `a0ac540` |
| 3 — instrumentation | `751cbbd` |
| 4 — state wiring | `e5bbdc8` |
| 5 — capability truthfulness | `751714c` |
| 6 — this report | _this commit_ |

## Remaining limitations (honest)

1. **State wiring** covers the synthesis panel; header / AI-summary / comms
   panels display their own values (non-contradictory) pending incremental
   migration to `transactionState()`.
2. **`review_opened` / `first_risk_created`** have no real commitment point in
   the current product and are intentionally unwired (documented above).
3. **Live Interceptor coverage** of an authenticated transaction view is limited
   in this environment (sign-in gated); public pricing is directly verifiable.
