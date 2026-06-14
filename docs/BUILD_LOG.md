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
