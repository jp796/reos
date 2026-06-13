---
name: ExtractionQuality
description: |
  Guards REOS's AI document-extraction accuracy — the core of the
  product. Contract / listing / settlement extraction must reliably
  pull dates (contract, closing, inspection, inspection-objection,
  financing, earnest-money), prices, parties, and commission. Silent
  null fields erode trust and make REOS unusable as a SaaS.

  USE WHEN: touching any *ExtractionService (Contract, Listing,
  DocumentClassifier, SignatureScan); changing the text→vision
  fallback routing; editing extraction prompts or schemas; a user
  reports "the scan isn't pulling <field>"; adding a new state's
  contract form; before shipping any extraction change.
---

# ExtractionQuality

The AI extraction pipeline is the heart of REOS. If it silently
returns `null` for an inspection or closing date, the TC loses trust
in the whole product. Treat extraction accuracy as a hard invariant,
not a best-effort.

## The architecture (know it before you touch it)

`ContractExtractionService.extract()` runs a **two-stage** pipeline:

1. **Text pass** — `pdftotext` layer → `gpt-4o-mini` with a strict
   JSON schema. Cheap (~$0.002), fast. Works when the PDF's text
   layer contains the filled-in values.
2. **Vision pass** — `pdftoppm` renders pages → `gpt-4o` vision reads
   the rendered images. Expensive (~$0.02), slower. Catches
   **flattened PDFs** (Dotloop / DocuSign) where filled values are
   burned into graphics and never reach the text layer.

`ListingExtractionService` mirrors this. `normalize()` / `asField()`
coerce whatever shape the model returns ({value,confidence,snippet},
flat string, or wrapper-nested) into the canonical field shape.

## The #1 failure mode (and the rule that prevents it)

**Symptom:** "the scan isn't pulling inspection / contract dates."

**Cause:** the text→vision fallback was gated ONLY by a regex
heuristic (`looksThin`) that guesses whether the text layer is
sparse. A flattened PDF whose text layer has template boilerplate
dates/dollars passes the heuristic (thin=false), so only the text
pass runs — and it returns `null` for the filled dates that live in
graphic overlays. Vision never fires.

**The rule — fallback must be OUTCOME-BASED, not heuristic-based:**

> If the critical timeline fields don't come back from the text pass,
> the text layer is incomplete by definition — run Vision and merge,
> regardless of what `looksThin` guessed.

Implemented as `criticalTimelineMissing()` in
`ContractExtractionService.ts`: when `closingDate` is null, or all
five critical deadlines (closing, inspection, inspection-objection,
financing, earnest-money) are null, fall through to Vision. Riders
(`compensationOnSeparateRider === true`) are exempt — they legitimately
have no timeline.

**Never** re-gate the Vision fallback on a pure text heuristic alone.
Missing dates IS the signal.

## Invariants to uphold on any extraction change

1. **Outcome-based fallback stays.** Don't remove
   `criticalTimelineMissing`. If you add fields the product depends
   on, add them to the critical set.
2. **`normalize()` runs on every model response** — text AND vision.
   The model returns inconsistent shapes; the normalizer is the only
   thing that makes them safe to read as `.value`.
3. **Never report success on an empty extraction.** UI must say what
   filled vs. what didn't — never a blanket "Extracted ✓" over a
   blank form (see ListingExtractionService fix, commit 42cdf2d).
4. **Vision page cap** (`MAX_VISION_PAGES`) must cover where dates
   live — usually pages 1–4 of a purchase contract. Don't drop it
   below 8.
5. **Run the regression harness** (below) before shipping.

## Regression harness — run before shipping any extraction change

```bash
# Drop sample contracts in test/fixtures/contracts/ (gitignored —
# they contain real PII). Each needs an expected.json sibling.
bun run scripts/test-extraction.ts
```

The harness runs every fixture PDF through `ContractExtractionService`
and asserts each expected field extracted (non-null + correct value).
It prints a per-field pass/fail matrix and exits non-zero on any
regression. Add a fixture for every contract format a customer uses
(WY WAR, CO CREC, MO RES-2000, TX TREC, etc.) — coverage is the only
defense against "works on my contract, breaks on theirs."

## When a user reports a missing field

1. Get the actual PDF (or a redacted one with the same structure).
2. Add it as a fixture with the expected values.
3. Run the harness — confirm it reproduces the miss.
4. Fix (usually: the field isn't in the critical set, the prompt
   label-list is missing that state's term, or the vision page cap
   is too low).
5. Re-run the harness — fixture now passes, and stays passing forever.

## Cost discipline

Vision is ~10× the cost of text. The outcome-based fallback only fires
when text genuinely failed, so cost stays low on clean PDFs and only
rises for the flattened ones that NEED vision. Don't "optimize" by
making the fallback lazier — a missed date costs a customer far more
than $0.02.
