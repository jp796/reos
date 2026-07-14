# REOS — Project Context for ATLAS

Real Estate Operating System. SaaS for transaction coordinators and
investor-agents. JP's product — Vicki is the primary TC user. Deployed
on Cloud Run, Neon Postgres, Next.js App Router.

**Full build invariants + pipeline map → `docs/BUILD.md` (read before touching core pipelines)**

---

## Quick context

- **Prod URL:** https://www.myrealestateos.com
- **Deploy:** GitHub push → Cloud Run (automatic via WIF). Revision currently serving: `reos-00145-sf9`
- **DB:** Neon Postgres. Prisma ORM. Migrations run in cloudbuild. Verify columns landed after deploy.
- **AI extraction:** GPT-4.1 (text) + GPT-4o (vision fallback). See `ContractExtractionService.ts`.
- **Rezen (Real):** Brokerage compliance system. Will Carter Team uses it. API token stored encrypted in `account.realApiTokensEncrypted`.

## Stack rules (non-negotiable)

- `bun/bunx` always. Never npm/npx.
- TypeScript always.
- Tenant isolation: EVERY data query scopes by `actor.accountId`. Never `findFirst()` an account.
- Typecheck before any commit: `bunx tsc --noEmit`
- Interceptor skill for all visual verification.

## Key files (load when needed, not all at once)

| What | Where |
|------|-------|
| Transaction detail page | `src/app/transactions/[id]/page.tsx` |
| Contact card (at-a-glance) | `src/app/transactions/[id]/EditablePrimaryContact.tsx` |
| Contract extraction AI | `src/services/ai/ContractExtractionService.ts` |
| Accepted contract scan | `src/services/automation/AcceptedContractScanService.ts` |
| Scan panel UI | `src/app/transactions/AcceptedContractScanPanel.tsx` |
| Create-from-scan API | `src/app/api/automation/create-from-scan/route.ts` |
| Rezen push service | `src/services/core/RezenPushService.ts` |
| Rezen status API | `src/app/api/integrations/rezen/status/route.ts` |
| Prisma schema | `prisma/schema.prisma` |
| Financials form | `src/app/transactions/[id]/FinancialsForm.tsx` |
| Rezen compliance panel | `src/app/transactions/[id]/RezenCompliancePrepPanel.tsx` |

## Current build state → see `docs/BUILD_LOG.md`

The build log tracks every feature shipped per session with file-level
detail, so any new session can resume without re-reading the full
codebase. Read it first if continuing a build.
