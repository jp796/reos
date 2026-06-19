# REOS — Build Log

Running session-by-session record of what shipped. Start here when resuming a build.
Newest entries at the top.

---

## EPIC: Investor Module (started 2026-06-14)

**Spec:** `docs/INVESTOR_MODULE_SPEC.md` · **Status tracker:** `docs/INVESTOR_MODULE_STATUS.md`

Extends REOS from retail-agent TC to a second ICP: the real estate investor
(TC + project management + rehab/draws). Ships as an **entitlement on the
existing account** — enhance, don't rebuild. 6 phases (§12): Phase 0 core
extensions → Wholesale → Flip+Draws → Rental/BRRRR → Creative → Hybrid.

### Session: 2026-06-14 — Spec intake + grounding

- Copied spec into `docs/INVESTOR_MODULE_SPEC.md` (persistent reference).
- Wrote `docs/INVESTOR_MODULE_STATUS.md` — full gap analysis (current schema vs.
  spec, ✅/🔧/🔴 per entity/engine) + phase checklist + open decisions.
- Grounding finding: current spine is `Transaction` (no `Asset`); no
  entitlements, `strategy`, `representation`, `title_path`, `Project`, `Draw`,
  `CapitalStack`; `Contact` has no `roles[]`. Confirms spec's "before" state.

### Session: 2026-06-14 — Phase 0 data foundation (SHIPPED to working tree)

**Decisions (JP delegated → ATLAS chose):** incremental/shadow Asset (nullable
`assetId`) · separate `entitlementsJson` array · Wholesale as first template.

**Files:**

| File | Change |
|------|--------|
| `prisma/schema.prisma` | New `Asset` model (spine: representation, titlePath, strategy, creativeSubstructure, economicsJson, agencyComponentJson, drive/chat handles). New `Project` model. `Transaction.assetId` nullable FK (`onDelete: SetNull`) + index. `Account.entitlementsJson` + back-relations. `Contact.rolesJson`. |
| `prisma/migrations/20260614180000_investor_module_phase0/migration.sql` | Hand-written, fully additive DDL (nullable/defaulted cols, 2 new tables, FKs, indexes). No data rewrite. Deploy applies it (BUILD.md Invariant 3). |
| `src/lib/entitlements.ts` | NEW. `readEntitlements` / `hasEntitlement` / `requireEntitlement` / `normalizeEntitlements`. null → `["retail_tc"]` so existing accounts unchanged. Mirrors `tier-gate.ts`. |
| `scripts/backfill-assets.ts` | NEW. Dry-run-by-default, idempotent. Creates 1 degenerate retail Asset per parentless Transaction + links it, in a `$transaction`. `--apply` to write, `--account=<id>` to scope. |
| `docs/INVESTOR_MODULE_STATUS.md` | Phase 0 checklist updated; open decisions → resolved. |

**Verify:** `prisma validate` ✅ · `prisma generate` ✅ · `bunx tsc --noEmit` → exit 0, 0 errors.

**SHIPPED + VERIFIED 2026-06-14.** Committed solo (`19d494c`), pushed to `main`,
deploy green (`Build + deploy 6m9s`). Serving revision **`reos-00153-wdf`**.
Prod DB check (Neon `curly-night-72426604`): `assets`+`projects` tables present,
`asset_id`/`entitlements_json`/`roles_json` columns present, FK present, migration
recorded in `_prisma_migrations`. **`transactions` with asset_id ≠ null = 0** —
shadow reparent confirmed, zero impact on existing retail deals. The 5 scan-card
files from the prior session were intentionally left uncommitted (push was
isolated to Phase 0 per JP).

**Next session (finish Phase 0 → start Wholesale):**
- [ ] Settings UI to grant the `investor` entitlement (Settings → Account/Plan)
- [ ] Retail / Investment / All filter on home + `/transactions`
- [ ] Auto-detect classifier (§5) writes strategy/representation/title_path at intake
- [ ] Then Phase 1: Wholesale 5-stage template + auto-advance + cash-buyers segment

### Session: 2026-06-14 (cont.) — Phase 0 UI + classifier

**Files:**

| File | Change |
|------|--------|
| `src/app/api/account/entitlements/route.ts` | NEW. Owner-only `POST` (toggle investor on/off, retail_tc always preserved) + `GET`. |
| `src/app/settings/account/InvestorModuleToggle.tsx` | NEW. Optimistic owner-only switch; calls the entitlements API. |
| `src/app/settings/account/page.tsx` | Renders the toggle (initial state from `readEntitlements`). |
| `src/app/transactions/page.tsx` | Retail/Investment/All **lens** filter — gated by `investor` entitlement; `buildHref` extended w/ `lens`; `lensWhere` maps investment→`asset.representation=principal`, retail→agency + legacy null-asset; lens counts queried only when shown. Scope toggle margin made conditional. |
| `src/services/core/DealClassifierService.ts` | NEW. Pure `classifyDeal()` — §5 rules, precedence creative→wholesale→BRRRR→flip→retail, with reasons[] + confidence. Not yet wired into intake (zero runtime risk). |
| `src/services/core/DealClassifierService.test.ts` | NEW. 12 standalone-tsx assertions, all passing. |

**Verify:** `bun tsx DealClassifierService.test.ts` → 12 passed · `bunx tsc --noEmit` → exit 0.

**Phase 0 status:** data foundation + entitlement toggle + lens filter SHIPPED. Classifier logic built+tested but **NOT wired** — the intake-pipeline wiring (create an Asset with classified fields at scan/upload) is the one remaining Phase 0 item; deferred to its own step with the extraction-quality skill + fixtures, then Phase 1 Wholesale.

> ⚠️ Interceptor CLI not installed in this env — the new Settings toggle and lens filter are build-verified (next build + tsc) and serving, but not visually confirmed in-browser. Eyeball at Settings → Account and /transactions, or install Interceptor (skill Update workflow).

### Session: 2026-06-14 (cont. 2) — Phase 0 classifier wiring + Phase 1 Wholesale

**Finishes Phase 0** (classifier→intake) **and starts Phase 1** (Wholesale wedge).

| File | Change |
|------|--------|
| `src/app/api/automation/create-from-scan/route.ts` | Every new deal now classifies (`classifyDeal`) + creates a parent **Asset** with strategy/representation/title_path, links `assetId`. Accepts optional investor signals in the body. Seeds stage-1 tasks for lifecycle strategies. Returns classification + stageSeeded. |
| `prisma/schema.prisma` + `migrations/20260614210000_investor_phase1_stage_tasks` | `Task.assetId` (FK) + `Task.stageKey` + `Task.templateKey`, additive. Asset↔Task back-relation. |
| `src/services/core/strategyTemplates.ts` | NEW. Wholesale 5-stage template (spec §6.2) as deterministic data + helpers (firstStage/nextStage/stageByKey/humanTasks). Flip/BRRRR/creative reserved (empty). |
| `src/services/core/strategyTemplates.test.ts` | NEW. 9 assertions, all passing. |
| `src/services/core/StageEngine.ts` | NEW. `applyStrategyTemplate` / `advanceStage` / `isCurrentStageComplete`. Stage tasks carry assetId+stageKey+templateKey (deduped), hang off the Asset's primary txn so they show in the existing TaskPanel. `auto` tasks not queued as human tasks. |
| `src/app/api/assets/[id]/advance-stage/route.ts` | NEW. Tenancy-guarded stage advance. |
| `src/app/transactions/[id]/StagePanel.tsx` + `page.tsx` | NEW panel — strategy + ordered stages + Advance button; gated to deals whose Asset has a lifecycle. Page query now includes `asset`. |
| `docs/HELP_KNOWLEDGE.md` | Added investor-module section (entitlement, lens, deal kinds, lifecycle). |

**Verify:** `bun tsx strategyTemplates.test.ts` → 9 passed · classifier 12 passed · `bunx tsc --noEmit` → 0 errors.

**Behavior note:** create-from-scan now ALWAYS creates an Asset (retail → degenerate agency Asset). Additive — existing retail queries/UI unchanged; new retail deals show under the Retail lens.

**Next:** auto-advance on task completion · cash-buyers segment · Drive/Chat auto-scaffold for `(auto)` tasks · then Flip (Phase 2: Draw engine + holding-cost meter).

---

## Session: 2026-06-13 — Scan info card + contact card fields

**Revision before this session:** `reos-00145-sf9` (prod, stable)

### What was built

**Goal:** When scanning Gmail for executed contracts or uploading a contract PDF, the
extracted commission %, inspection deadline, inspection objection deadline, and Rezen
API status should all appear on the transaction detail page — no manual re-entry.

**Files changed:**

| File | Change |
|------|--------|
| `src/services/automation/AcceptedContractScanService.ts` | `AcceptedContractHit` type now includes `inspectionDeadline`, `inspectionObjectionDeadline`, `titleObjectionDeadline`, `sellerSideCommissionPct`, `buyerSideCommissionPct`. Populated from the `ContractExtractionService` result in `out.hits.push()`. |
| `src/app/transactions/AcceptedContractScanPanel.tsx` | `Hit` interface updated to match. `createTransaction()` now passes all new fields to `POST /api/automation/create-from-scan`. Hit card shows commission %, inspection date, objection date inline (before creating). |
| `src/app/api/automation/create-from-scan/route.ts` | `TransactionFinancials` upsert now saves `commissionPercent` (was only saving `salePrice` and `grossCommission`). Normalizes decimal (0.025) → human pct (2.5) before storing. |
| `src/app/transactions/[id]/EditablePrimaryContact.tsx` | New props: `inspectionDeadline`, `inspectionObjectionDeadline`, `rezenConnected`. New chips in at-a-glance row: Inspection date, Objection date, Rezen connected/not badge. Icons: `ClipboardList`, `ShieldCheck`, `ShieldOff`. |
| `src/app/transactions/[id]/page.tsx` | Passes `inspectionDeadline={txn.inspectionDate}`, `inspectionObjectionDeadline={txn.inspectionObjectionDate}`, `rezenConnected={!!account?.realApiTokensEncrypted}` to `EditablePrimaryContact`. Adds **Commission %** `Fact` cell to the Facts grid (was missing — only gross $ was shown). |

**TypeScript:** `bunx tsc --noEmit` — 0 errors after all changes.

### What was already live (from prior session reos-00145-sf9)

- Signature-scan tracker
- Per-slot doc pinning in Rezen compliance prep panel
- Send-to-Rezen stub (`/api/transactions/[id]/send-to-rezen`)
- All 4 migration columns confirmed in prod DB

### What's next (not yet built)

- [ ] **Wire up Send-to-Rezen fully** — the stub exists but the actual Real API push
  (`RezenPushService.ts`) needs the commission/deadline data now flowing from extraction.
  The stub at `/api/transactions/[id]/send-to-rezen/route.ts` should call
  `RezenPushService` with the transaction's financial + deadline fields.
- [ ] **Rezen status live-check** — current `/api/integrations/rezen/status` only checks
  token *presence*, not validity. Add a lightweight Real API ping (GET /agents/me or
  similar) to confirm the token is still valid.
- [ ] **Contact card — commission % auto-compute display** — when commission % is known
  but grossCommission is null (e.g. scan found % but no price yet), show
  "X% · enter price to compute GCI" as a hint in the chip.
- [ ] **Inspection objection deadline auto-compute nudge** — if inspectionDate is set
  but inspectionObjectionDate is null, show a soft nudge in the contact card
  ("Set objection deadline — typically X days after inspection").

---

## Session: 2026-06-12 — Signature scan, doc pinning, Send-to-Rezen stub

**Revision:** `reos-00145-sf9`

- Signature-scan tracker shipped
- Per-slot doc pinning in Rezen compliance prep
- Send-to-Rezen stub live
- 4 migration columns confirmed in prod DB

### Session: 2026-06-14 (cont. 3) — Phases 1–5 COMPLETE

Drove the full investor module to completion (all spec §6 strategies + §7/§9/§10 engines).

| Area | Files |
|------|------|
| All templates (Flip/Rental/Creative) | `strategyTemplates.ts` (+ tests, 14) |
| Auto-advance on task completion (§8.1) | `tasks/[tid]/route.ts` |
| Economics (§9) | `DealEconomicsService.ts` (+ tests, 7) |
| Holding-cost meter (§7) | `HoldingCostMeter.ts` (+ tests, 4) |
| Draw engine + capital stack (§7) | `DrawEngine.ts` (+ tests, 7), migration `20260614223000`, `/api/assets/[id]/draws*`, `/capital`, `DrawCapitalPanel.tsx` |
| Recurring engine (§7) | `StageEngine.generateRecurringTasks` + `/api/assets/recurring/generate` |
| Investor risk (§10) | `InvestorRiskService.ts` (+ tests, 9), wired into deal page |
| Cash-buyers segment (§7) | `/api/contacts/cash-buyers`, `/contacts/cash-buyers` page |
| Unified Production (§9) | revenue-split section on `/production` |
| Hybrid + override (§1/§5) | `PATCH /api/assets/[id]` (classification + agencyComponent) |
| Drive/Chat scaffold (§7/§11) | `DealWorkspaceService.ts` — flag-gated OFF (boundary documented) |

**Verify:** 53 unit tests green · `bunx tsc --noEmit` 0 errors · 2 deploys green this session (logic chunk + Phase 2 migration), final chunk deploying now.

**Remaining to ACTIVATE (not code — ops):** add Drive scope to DEFAULT_SCOPES + re-consent and provision Google Chat API to flip `INVESTOR_DRIVE_ENABLED`/`INVESTOR_CHAT_ENABLED` on. Legal review (§13) before scaling Creative.

### Session: 2026-06-17 — Atlas Agent Phase A (tool layer)

Spec: docs/ATLAS_AGENT_SPEC.md. Built the deterministic action layer the
conversational agent will drive (the "no mistakes" core).

| File | Change |
|------|--------|
| `src/services/ai/AtlasTools.ts` | NEW. Tool registry + typed executors: find_deal (read), add_task, complete_task, set_deadline, advance_stage, set_stage, add_note (write). Each validates args (zod), resolves the deal with tenancy + per-deal-visibility enforced, calls an existing engine, writes an AutomationAuditLog row, returns actual state. Tiers (read/write/sensitive) + requiresConfirmation + openAiToolSpecs + executeTool dispatcher. |
| `src/services/ai/AtlasTools.test.ts` | NEW. 6 tests — registry integrity, tier gating, deny-by-default, schema rejection. |
| `src/app/api/atlas/execute/route.ts` | NEW. POST /api/atlas/execute — the single server-side action point (auth + tenancy + audit), called after a confirmed write. |

**Verify:** AtlasTools 6 passed · tsc 0 errors. Additive (new files only) — no behavior change to existing surfaces.

**Next (Phase A.2):** wire askAtlas tool-calling loop (read auto, write → proposed actions) + chat UI confirm flow + Telegram confirm state. Then Phase B/C/D per spec.

### Session: 2026-06-17 (cont.) — Atlas Agent Phase A.2 (conversational loop)

| File | Change |
|------|--------|
| `src/services/ai/AtlasChatService.ts` | askAtlas is now AGENTIC: bounded tool-loop — read tools auto-run, write tools return as proposedActions (NOT executed). Returns {text, proposedActions}. Signature now (db, actor, text). Prompt hardened to MANDATE find_deal before acting/claiming-no-deal (fixed mini answering from context). |
| `src/services/ai/AtlasTools.ts` | Real per-tool JSON param schemas (openAiToolSpecs) so the model calls tools correctly. previewAction() for confirm prompts. resolveDeal made token-based (all significant words must match → "3453 Willard" finds the full address). |
| `prisma/schema.prisma` + `migrations/20260617130000_atlas_pending_actions` | AtlasPendingAction (per account/user/channel) — parks a proposed write until "yes". |
| `src/app/api/integrations/telegram/webhook/route.ts` | Resolves actor by AUTH_ALLOWED_EMAILS (FIXED account.findFirst tenant bug). yes/no confirm flow over the pending store; proposals upserted + previewed; stale pending cleared on a non-confirm turn. |

**Verify (against real prod DB + OpenAI):** full loop ask→find_deal→propose add_task→execute→DB persisted→cleaned up ✓. tsc 0 · AtlasTools 6 tests. Two real bugs found+fixed mid-verify: token matching + the findFirst tenant bug.

**Next:** in-app chat UI (Telegram is live); proactive nudges (Phase C); money/external tools double-confirm (Phase D).

### Session: 2026-06-18 — Atlas Agent Phase A.3 (create a deal from a Telegram upload)

Goal: send the bot a contract PDF (or a photo of a contract) → Atlas
extracts → proposes the deal → "yes" → deal created. Same
confirm-before-write discipline as A.2; no direct writes.

| File | Change |
|------|--------|
| `src/services/core/createDealFromExtraction.ts` | NEW. Shared deal-creation core (contact upsert → classify → Asset → Transaction → milestones → financials → stage seed) mirroring create-from-scan, so the agent path produces identical deals. Exports DealFields + CreateDealResult. Dedup on account+contact+address. |
| `src/services/integrations/TelegramService.ts` | `downloadFile(fileId)` — Telegram 2-step getFile → fetch binary → Buffer. |
| `src/services/ai/ContractExtractionService.ts` | `extractFromImages(buffers)` — feeds raw JPEG bytes to GPT-4o vision, reusing the same schema/normalize/relative-deadline pipeline. |
| `src/services/ai/AtlasTools.ts` | `create_deal` tool (tier sensitive — always confirmed): zod `{address}.passthrough()`, runs createDealFromExtraction + audit, returns summary w/ /transactions link. PARAM_SCHEMAS + previewAction case added. |
| `src/app/api/integrations/telegram/webhook/route.ts` | Upload branch: document/photo → `handleUpload` → download → extract (PDF=text, photo=vision) → `fieldsFromExtraction` → upsert pending create_deal → reply summary + "reply yes". |

**Verify:** tsc 0 errors · deploy green (reos-00175-fws serving) · webhook 200 silent-reject without secret header. No new schema (AtlasPendingAction already deployed). E2E pending JP's real upload (1208 Windmill).

**Next:** in-app chat UI (Phase B); proactive nudges (Phase C); money/external tools double-confirm (Phase D); add users Sheri + Heather.
