# REOS — Master Build Doc

The single index of build-time invariants and the skills that enforce
them. Read this before shipping anything that touches the core
pipelines. Each invariant exists because breaking it produced a real
bug that eroded product trust.

> REOS is a SaaS. "Works on my contract" is not good enough — a silent
> null field or a cross-tenant leak loses a customer. Treat the
> invariants below as hard requirements, not guidelines.

---

## Skills (in `.claude/skills/`)

| Skill | Enforces | Fires when |
|-------|----------|-----------|
| **ExtractionQuality** | AI document-extraction accuracy (dates, prices, parties) | touching any `*ExtractionService`, extraction prompts/schemas, or when a user reports "scan isn't pulling X" |
| **ScraperGuardrails** | Auth + rate-limit + bot-defense on data paths | adding any public route/page/API touching user data |
| **help-docs-keeper** | `docs/HELP_KNOWLEDGE.md` stays current | shipping any new page / endpoint / settings panel |

---

## Invariant 1 — AI extraction must pull deadline DATES reliably

**The product is worthless if the scan returns null for inspection /
closing / financing dates.** Full detail in
`.claude/skills/extraction-quality/SKILL.md`. The load-bearing rules:

1. **Two-stage pipeline.** Text (`gpt-4o-mini`) first; Vision
   (`gpt-4o` over rendered pages) catches flattened PDFs.
2. **Outcome-based Vision fallback** (`criticalTimelineMissing`) — if
   the critical dates didn't come back, run Vision regardless of the
   `looksThin` heuristic. Don't re-gate on text heuristics alone.
3. **Relative deadlines** — many contracts state deadlines as offsets
   ("10 business days after the Effective Date"), not absolute dates.
   The extractor captures the offset (`inspectionPeriodDays` etc.) and
   `computeRelativeDeadlines()` fills the absolute date from the
   Effective Date. When the Effective Date is blank in the doc, the
   UI must prompt for it so the deadlines compute.
4. **`normalize()` on every model response** — text AND vision. The
   model returns inconsistent shapes; the normalizer makes them safe.
5. **Never report success over a blank extraction** — the UI says what
   filled vs. what didn't (listing form fix, commit 42cdf2d).
6. **Run `scripts/test-extraction.ts`** against fixture contracts
   before shipping any extraction change. Add a fixture for every
   state's contract form a customer uses.

## Invariant 2 — Tenant isolation on every data path

Every query that returns tenant-owned data (Transaction, Contact,
Document, etc.) MUST scope by `actor.accountId` from `requireSession()`.
NEVER `prisma.<model>.findFirst()` to pick "an account" — that's the
bug that filed JP's Wyoming deal under another tenant (commit 049cf87).
ScraperGuardrails skill covers the public-surface side.

## Invariant 3 — Migrations apply in the deploy, not just locally

Neon idles and is sometimes unreachable from a laptop. The cloudbuild
migrate step has a retry-for-wake loop. Write the migration, commit
it, let the deploy apply it; verify the columns landed in prod after.

## Invariant 4 — Every deploy is verified

Auto-deploy via GitHub Actions (Workload Identity Federation, no JSON
key). After a push: confirm the run is green, the Cloud Run revision
rolled, and smoke-test the changed surface. Don't claim "shipped"
until the revision is serving.

---

## Pipelines & where they live

| Pipeline | Entry points |
|----------|-------------|
| Contract extraction | `src/services/ai/ContractExtractionService.ts` → `/api/transactions/[id]/contract/{extract,apply,rescan}`, `AcceptedContractScanService` |
| Listing extraction | `src/services/ai/ListingExtractionService.ts` → `/api/listings/extract` |
| Doc classification | `src/services/ai/DocumentClassifierService.ts` → Rezen prep |
| Signature scan | `src/services/ai/SignatureScanService.ts` → `/api/transactions/[id]/scan-signatures` |
| Rezen push | `src/services/integrations/RealApiService.ts` + `RezenPushService.ts` → `/api/transactions/[id]/send-to-rezen` |
| Morning brief | `src/services/automation/MorningTick.ts` |

## Regression harnesses

| Harness | Run |
|---------|-----|
| Extraction accuracy | `OPENAI_API_KEY=$(gcloud secrets versions access latest --secret=OPENAI_API_KEY) bun run scripts/test-extraction.ts` |
| Typecheck (always) | `./node_modules/.bin/tsc --noEmit` |
